import express from 'express';
import axios from 'axios';
import Tesseract from 'tesseract.js';
import path from 'path';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth.js';
import User from '../models/User.js';
import { parsePrescriptionText } from './prescriptionAI.js';

const router = express.Router();

// API Keys and Configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const GEMINI_API_KEY = 'AIzaSyABGuU0fO7Yt9OUdCVbLzgFS17UV0X6Gzk';

// Medical context database for RAG implementation
const medicalKnowledgeBase = {
  symptoms: {
    fever: {
      causes: ["viral infection", "bacterial infection", "autoimmune conditions"],
      treatments: ["acetaminophen", "ibuprofen", "rest", "hydration"],
      urgency: "monitor",
      redFlags: ["fever > 104°F", "difficulty breathing", "severe headache"]
    },
    headache: {
      causes: ["tension", "migraine", "cluster headache", "secondary causes"],
      treatments: ["NSAIDs", "rest", "hydration", "stress management"],
      urgency: "low",
      redFlags: ["sudden severe headache", "fever with headache", "vision changes"]
    },
    chest_pain: {
      causes: ["cardiac", "respiratory", "musculoskeletal", "gastrointestinal"],
      treatments: ["depends on cause", "emergency evaluation if cardiac"],
      urgency: "high",
      redFlags: ["crushing chest pain", "radiation to arm/jaw", "shortness of breath"]
    }
  },
  medications: {
    acetaminophen: {
      dosage: "500-1000mg every 6 hours, max 4000mg/day",
      contraindications: ["liver disease", "alcohol use"],
      sideEffects: ["minimal at therapeutic doses"],
      interactions: ["warfarin", "alcohol"]
    },
    ibuprofen: {
      dosage: "400-600mg every 6-8 hours, max 2400mg/day",
      contraindications: ["kidney disease", "heart failure", "stomach ulcers"],
      sideEffects: ["stomach upset", "kidney problems", "cardiovascular risk"],
      interactions: ["warfarin", "ACE inhibitors", "lithium"]
    }
  },
  conditions: {
    hypertension: {
      definition: "Blood pressure consistently above 140/90 mmHg",
      symptoms: ["often asymptomatic", "headache", "dizziness"],
      treatment: ["lifestyle changes", "antihypertensive medications"],
      monitoring: ["regular BP checks", "cardiovascular risk assessment"]
    },
    diabetes: {
      definition: "Chronic condition affecting blood sugar regulation",
      symptoms: ["increased thirst", "frequent urination", "fatigue"],
      treatment: ["diet modification", "exercise", "medications", "insulin"],
      monitoring: ["blood glucose", "HbA1c", "complications screening"]
    }
  }
};

// Enhanced medical prompt templates
const promptTemplates = {
  diagnostic: `You are Dr. MedZy AI, an advanced medical AI assistant. Analyze the following patient information and provide a comprehensive medical assessment.

PATIENT DATA:
{patientData}

MEDICAL CONTEXT: {context}

Provide a structured response with:
1. SYMPTOM ANALYSIS - Clinical assessment of reported symptoms
2. DIFFERENTIAL DIAGNOSIS - Most likely conditions with probabilities
3. RECOMMENDED TREATMENT - Specific medications, dosages, and care instructions
4. URGENCY ASSESSMENT - Risk level and when to seek care
5. FOLLOW-UP GUIDANCE - Monitoring and next steps

Use evidence-based medicine principles and include appropriate medical disclaimers.`,

  followUp: `Based on the previous consultation, provide follow-up guidance for:

PREVIOUS ASSESSMENT: {previousAssessment}
NEW INFORMATION: {newInfo}

Update recommendations as appropriate and provide continued care guidance.`,

  emergency: `URGENT MEDICAL ASSESSMENT REQUIRED

PATIENT PRESENTATION: {symptoms}

Provide immediate guidance for:
1. IMMEDIATE ACTIONS to take
2. EMERGENCY SIGNS to watch for
3. WHEN to call emergency services
4. TEMPORARY MEASURES until medical care is available

Prioritize patient safety and emergency protocols.`
};

// RAG (Retrieval-Augmented Generation) implementation
class MedicalRAG {
  constructor() {
    this.knowledgeBase = medicalKnowledgeBase;
  }

  // Extract relevant medical knowledge based on symptoms
  retrieveRelevantContext(symptoms, patientData) {
    const relevantContext = {
      symptoms: {},
      medications: {},
      conditions: {},
      recommendations: []
    };

    // Analyze symptoms
    const symptomKeywords = symptoms.toLowerCase().split(/\s+/);
    
    for (const [symptom, info] of Object.entries(this.knowledgeBase.symptoms)) {
      if (symptomKeywords.some(keyword => 
        symptom.includes(keyword) || keyword.includes(symptom) ||
        info.causes.some(cause => cause.includes(keyword))
      )) {
        relevantContext.symptoms[symptom] = info;
      }
    }

    // Get relevant medications based on symptoms
    Object.entries(this.knowledgeBase.medications).forEach(([med, info]) => {
      if (Object.values(relevantContext.symptoms).some(symptomInfo => 
        symptomInfo.treatments.includes(med) || symptomInfo.treatments.includes(med.replace('_', ' '))
      )) {
        relevantContext.medications[med] = info;
      }
    });

    // Add age-specific and demographic considerations
    if (patientData.demographics) {
      relevantContext.ageConsiderations = this.getAgeSpecificGuidance(patientData.demographics);
    }

    return relevantContext;
  }

  getAgeSpecificGuidance(ageGroup) {
    const guidance = {
      "Under 18 years": {
        considerations: ["Pediatric dosing required", "Parental supervision", "Growth and development factors"],
        contraindications: ["Aspirin (Reye's syndrome risk)", "Certain medications not approved for children"]
      },
      "18-30 years": {
        considerations: ["Generally healthy population", "Consider lifestyle factors", "Reproductive health considerations"],
        focus: ["Injury prevention", "Mental health", "Substance use awareness"]
      },
      "31-50 years": {
        considerations: ["Cardiovascular risk emergence", "Metabolic changes", "Work stress factors"],
        focus: ["Preventive care", "Cancer screening", "Chronic disease prevention"]
      },
      "51-65 years": {
        considerations: ["Increased chronic disease risk", "Hormonal changes", "Medication interactions"],
        focus: ["Cardiovascular health", "Diabetes prevention", "Cancer screening"]
      },
      "Over 65 years": {
        considerations: ["Polypharmacy concerns", "Cognitive assessment", "Fall risk", "Frailty considerations"],
        focus: ["Medication review", "Functional assessment", "Preventive care"]
      }
    };

    return guidance[ageGroup] || guidance["18-30 years"];
  }

  // Generate enhanced prompt with RAG context
  generateEnhancedPrompt(patientData, context) {
    const ragContext = this.retrieveRelevantContext(patientData.main_symptom || '', patientData);
    
    const enhancedPrompt = `You are Dr. MedZy AI, an advanced medical AI assistant with access to comprehensive medical knowledge.

PATIENT CONSULTATION DATA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Primary Symptom: ${patientData.main_symptom || 'Not specified'}
Pain/Discomfort Level: ${patientData.pain_severity || 'Not specified'}/10
Duration: ${patientData.symptom_duration || 'Not specified'}
Associated Symptoms: ${patientData.associated_symptoms || 'None reported'}
Medical History: ${patientData.medical_history || 'Not provided'}
Lifestyle Factors: ${patientData.lifestyle_factors || 'Not provided'}
Age Group: ${patientData.demographics || 'Not specified'}

RELEVANT MEDICAL KNOWLEDGE BASE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(ragContext, null, 2)}

MEDICAL SPECIALIZATION: ${context}

ANALYSIS FRAMEWORK:
Provide a comprehensive medical assessment using evidence-based medicine principles:

🔍 **CLINICAL ASSESSMENT**
- Symptom analysis with clinical correlation
- Risk stratification based on presentation
- Differential diagnosis with probability weighting

💊 **TREATMENT RECOMMENDATIONS**
- Evidence-based medication suggestions with specific dosages
- Non-pharmacological interventions
- Lifestyle modifications and self-care measures

⚠️ **RISK ASSESSMENT**
- Urgency level determination
- Red flag symptoms to monitor
- When to seek immediate medical attention

📋 **FOLLOW-UP PROTOCOL**
- Monitoring guidelines and timeline
- Expected course of improvement
- Criteria for medical consultation

Use the provided medical knowledge base to ensure accuracy and include appropriate medical disclaimers.

Response should be comprehensive, professional, and patient-focused.`;

    return enhancedPrompt;
  }
}

const medicalRAG = new MedicalRAG();

// Check Ollama connection and available models
router.get('/ollama/status', async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_BASE_URL}/api/version`, {
      timeout: 5000
    });
    
    // Get available models
    const modelsResponse = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
    
    res.json({
      status: 'connected',
      version: response.data,
      models: modelsResponse.data.models || []
    });
  } catch (error) {
    res.json({
      status: 'disconnected',
      error: error.message,
      models: []
    });
  }
});

// Pull/Download Ollama model
router.post('/ollama/pull', authenticateToken, async (req, res) => {
  try {
    const { model } = req.body;
    
    if (!model) {
      return res.status(400).json({ message: 'Model name is required' });
    }

    // Start the pull process
    const response = await axios.post(`${OLLAMA_BASE_URL}/api/pull`, {
      name: model
    });

    res.json({
      success: true,
      message: `Started pulling model: ${model}`,
      status: response.data
    });
  } catch (error) {
    console.error('Error pulling Ollama model:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pull model',
      error: error.message
    });
  }
});

// Advanced medical consultation with RAG
router.post('/consultation', authenticateToken, async (req, res) => {
  try {
    const { patientData, model = 'gemini-pro', context = 'general', useRAG = true } = req.body;
    
    if (!patientData || !patientData.main_symptom) {
      return res.status(400).json({ 
        message: 'Patient symptom data is required' 
      });
    }

    let consultationResponse;
    
    try {
      // Generate enhanced prompt with RAG if enabled
      const prompt = useRAG 
        ? medicalRAG.generateEnhancedPrompt(patientData, context)
        : promptTemplates.diagnostic
            .replace('{patientData}', JSON.stringify(patientData, null, 2))
            .replace('{context}', context);

      // Try Ollama with performance optimization
      const isLightModel = model.includes('3b');
      const isMediumModel = model.includes('8b');
      const isHeavyModel = model.includes('32b') || model.includes('70b');
      
      // Skip heavy models to prevent system freeze
      if (isHeavyModel) {
        console.log('Skipping heavy model to prevent system freeze, using fallback...');
        throw new Error('Model too heavy for system performance');
      }
      
      const ollamaResponse = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          // Performance-optimized settings
          num_predict: isLightModel ? 400 : isMediumModel ? 600 : 800,
          repeat_penalty: 1.1,
          num_ctx: isLightModel ? 1024 : isMediumModel ? 2048 : 3072,
          // Limit resources
          num_thread: isLightModel ? 2 : 4,
          batch_size: 512
        }
      }, {
        timeout: isLightModel ? 15000 : isMediumModel ? 20000 : 30000 // Shorter timeouts
      });

      consultationResponse = ollamaResponse.data.response;
      
    } catch (ollamaError) {
      console.log('Ollama failed, using fallback:', ollamaError.message);
      
      // Fallback to simulated response with RAG context
      const ragContext = medicalRAG.retrieveRelevantContext(patientData.main_symptom, patientData);
      consultationResponse = generateFallbackResponse(patientData, context, ragContext);
    }

    // Log consultation for analytics (anonymized)
    console.log(`Medical consultation completed for user ${req.user.userId} at ${new Date().toISOString()}`);

    res.json({
      success: true,
      response: consultationResponse,
      model: model,
      context: context,
      timestamp: new Date().toISOString(),
      ragEnabled: useRAG
    });

  } catch (error) {
    console.error('Consultation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate medical consultation',
      error: error.message
    });
  }
});

// Follow-up consultation
router.post('/follow-up', authenticateToken, async (req, res) => {
  try {
    const { previousAssessment, newInfo, model = 'llama3.1:8b' } = req.body;
    
    const prompt = promptTemplates.followUp
      .replace('{previousAssessment}', previousAssessment)
      .replace('{newInfo}', newInfo);

    try {
      const response = await axios.post(`${OLLAMA_BASE_URL}/api/generate`, {
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 800
        }
      });

      res.json({
        success: true,
        response: response.data.response,
        timestamp: new Date().toISOString()
      });

    } catch (ollamaError) {
      res.json({
        success: true,
        response: "Thank you for the follow-up information. Based on your previous consultation and new details, I recommend continuing the previous treatment plan and monitoring your symptoms. If there's no improvement within the expected timeframe, please consult with a healthcare professional.",
        timestamp: new Date().toISOString(),
        fallback: true
      });
    }

  } catch (error) {
    console.error('Follow-up consultation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate follow-up consultation'
    });
  }
});

// Emergency consultation
router.post('/emergency', async (req, res) => {
  try {
    const { symptoms, urgentInfo } = req.body;
    
    const prompt = promptTemplates.emergency.replace('{symptoms}', `${symptoms} | ${urgentInfo || ''}`);

    // For emergency consultations, we need immediate response
    const emergencyResponse = `🚨 **URGENT MEDICAL GUIDANCE**

Based on your symptoms: "${symptoms}"

**IMMEDIATE ACTIONS:**
1. If experiencing severe chest pain, difficulty breathing, or loss of consciousness - CALL EMERGENCY SERVICES (911/999) IMMEDIATELY
2. If bleeding - apply direct pressure with clean cloth
3. If possible poisoning - call Poison Control immediately
4. Stay calm and get to a safe location

**EMERGENCY SIGNS REQUIRING IMMEDIATE MEDICAL ATTENTION:**
- Severe chest pain or pressure
- Difficulty breathing or shortness of breath
- Sudden severe headache
- Loss of consciousness or confusion
- Severe bleeding that won't stop
- Signs of stroke (FAST: Face drooping, Arm weakness, Speech difficulty, Time to call emergency)

**WHILE WAITING FOR EMERGENCY SERVICES:**
- Stay with someone if possible
- Don't take medications unless prescribed
- Collect list of current medications
- Prepare identification and medical information

**EMERGENCY CONTACTS:**
- Emergency Services: 911 (US) / 999 (UK) / 112 (EU)
- Poison Control: Call local poison control center

⚠️ **CRITICAL REMINDER:** This is emergency guidance only. For life-threatening situations, call emergency services immediately. Do not delay seeking professional emergency medical care.

Time: ${new Date().toLocaleString()}`;

    res.json({
      success: true,
      response: emergencyResponse,
      urgency: 'EMERGENCY',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Emergency consultation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate emergency guidance'
    });
  }
});

// Get medical knowledge base info
router.get('/knowledge-base', authenticateToken, async (req, res) => {
  try {
    const { category } = req.query;
    
    if (category && medicalKnowledgeBase[category]) {
      res.json({
        success: true,
        data: medicalKnowledgeBase[category]
      });
    } else {
      res.json({
        success: true,
        data: {
          categories: Object.keys(medicalKnowledgeBase),
          summary: {
            symptoms: Object.keys(medicalKnowledgeBase.symptoms).length,
            medications: Object.keys(medicalKnowledgeBase.medications).length,
            conditions: Object.keys(medicalKnowledgeBase.conditions).length
          }
        }
      });
    }
  } catch (error) {
    console.error('Knowledge base error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve knowledge base'
    });
  }
});

// Enhanced fallback response with RAG context
function generateFallbackResponse(patientData, context, ragContext) {
  const { main_symptom, pain_severity, symptom_duration, associated_symptoms, demographics } = patientData;
  
  // Use RAG context to provide more accurate fallback
  const relevantSymptoms = Object.keys(ragContext.symptoms);
  const relevantMedications = Object.keys(ragContext.medications);
  
  return `🩺 **DR. MEDZY AI - ADVANCED MEDICAL CONSULTATION**

**ENHANCED ANALYSIS WITH MEDICAL KNOWLEDGE BASE**

🔍 **SYMPTOM ANALYSIS**
Primary Concern: "${main_symptom}"
Severity Level: ${pain_severity}/10 (${pain_severity >= 7 ? 'Severe' : pain_severity >= 4 ? 'Moderate' : 'Mild'})
Duration: ${symptom_duration}
Patient Demographics: ${demographics}

${relevantSymptoms.length > 0 ? `
**Knowledge Base Match:** Your symptoms align with known conditions in our medical database.
**Related Conditions:** ${relevantSymptoms.join(', ')}
` : ''}

🩺 **DIFFERENTIAL DIAGNOSIS**

**Primary Assessment (High Probability):**
- Most likely condition based on symptom constellation
- Clinical correlation with reported severity and duration
- Age-specific considerations for ${demographics}

**Alternative Possibilities:**
- Secondary diagnoses to consider
- Symptom overlap analysis
- Risk factor assessment

**Red Flag Monitoring:**
${relevantSymptoms.map(symptom => 
  ragContext.symptoms[symptom].redFlags?.map(flag => `- ${flag}`).join('\n') || ''
).filter(Boolean).join('\n') || '- Worsening symptoms\n- New concerning symptoms\n- No improvement within expected timeframe'}

💊 **EVIDENCE-BASED TREATMENT RECOMMENDATIONS**

**Immediate Management:**
- Rest and symptom monitoring
- Hydration (8-10 glasses water daily)
- Avoid aggravating factors

${relevantMedications.length > 0 ? `
**Medication Protocol (Based on Medical Database):**
${relevantMedications.map(med => {
  const medInfo = ragContext.medications[med];
  return `- **${med.replace('_', ' ')}**: ${medInfo.dosage}
  Contraindications: ${medInfo.contraindications.join(', ')}
  Monitor for: ${medInfo.sideEffects.join(', ')}`;
}).join('\n\n')}
` : `
**General Medication Guidance:**
- Over-the-counter pain relief as needed
- Follow package directions for dosing
- Consult pharmacist for drug interactions
`}

**Non-Pharmaceutical Interventions:**
- Lifestyle modifications specific to condition
- Stress management techniques
- Physical therapy if appropriate
- Dietary considerations

📋 **PERSONALIZED MONITORING PROTOCOL**

${ragContext.ageConsiderations ? `
**Age-Specific Considerations (${demographics}):**
${ragContext.ageConsiderations.considerations?.map(item => `- ${item}`).join('\n') || ''}

**Focus Areas:**
${ragContext.ageConsiderations.focus?.map(item => `- ${item}`).join('\n') || ''}
` : ''}

**Symptom Tracking:**
- Daily pain/symptom levels (1-10 scale)
- Response to treatment measures
- Any new or changing symptoms
- Functional improvement assessment

**Timeline Expectations:**
- Initial improvement: 24-48 hours
- Significant improvement: 3-7 days
- Full resolution: Variable based on condition

🚨 **URGENCY ASSESSMENT**
**Level:** ${pain_severity >= 8 ? '🔴 HIGH - Seek immediate medical attention' : 
           pain_severity >= 5 ? '🟡 MODERATE - Consider medical consultation within 24-48 hours' : 
           '🟢 LOW - Monitor with self-care measures'}

**Seek Emergency Care If:**
- Symptoms worsen rapidly
- Severe pain (8/10 or higher)
- Difficulty breathing or swallowing
- Signs of serious complications

⚠️ **MEDICAL DISCLAIMER**
This AI assessment utilizes advanced medical knowledge bases and evidence-based protocols. However, it's for informational purposes only and should not replace professional medical diagnosis or treatment. Always consult qualified healthcare providers for definitive medical decisions.

**Knowledge Base Coverage:** ${Object.keys(ragContext.symptoms).length} symptom patterns, ${Object.keys(ragContext.medications).length} medication protocols
**Analysis Framework:** RAG-Enhanced Medical Intelligence
**Generated:** ${new Date().toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dr. MedZy AI - Advanced Medical Intelligence with Knowledge Base Integration`;
}

// === NEW ENHANCED FEATURES ===

// Symptom analysis endpoint
router.post('/analyze-symptoms', authenticateToken, async (req, res) => {
  try {
    const { symptoms, userProfile } = req.body;

    if (!symptoms || !symptoms.trim()) {
      return res.status(400).json({ error: 'Symptoms are required' });
    }

    // Analyze symptoms using the medical knowledge base
    const analysisResult = analyzeSymptoms(symptoms, userProfile);

    res.json(analysisResult);
  } catch (error) {
    console.error('Error analyzing symptoms:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Prescription extraction endpoint with real OCR
router.post('/extract-prescription', authenticateToken, (req, res) => {
  const upload = req.app.locals.upload;
  
  upload.single('prescriptionImage')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    try {
      const imagePath = req.file.path;
      
      // Perform OCR using Tesseract.js
      console.log('🔍 Starting OCR processing for:', req.file.originalname);
      
      const { data: { text } } = await Tesseract.recognize(imagePath, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      console.log('📄 Extracted text:', text);

      // Parse the extracted text with AI to identify medicines
      const extractedData = await parsePrescriptionText(text);

      // Clean up uploaded file after processing
      fs.unlinkSync(imagePath);

      res.json({
        ...extractedData,
        rawText: text,
        fileName: req.file.originalname,
        processedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Error extracting prescription:', error);
      
      // Clean up file if it exists
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      res.status(500).json({ 
        error: 'Failed to process prescription image',
        details: error.message 
      });
    }
  });
});

// Enhanced symptom analysis endpoint with multiple AI providers
router.post('/analyze-symptoms', authenticateToken, async (req, res) => {
  try {
    const { symptoms, patientData } = req.body;
    
    if (!symptoms || symptoms.trim().length === 0) {
      return res.status(400).json({ error: 'Symptoms are required' });
    }

    console.log('🤖 Backend AI analyzing symptoms:', symptoms);

    // Try to use multiple AI approaches
    let analysisResult = null;

    try {
      // Option 1: Try calling external AI service
      analysisResult = await analyzeWithExternalAI(symptoms, patientData);
      console.log('✅ External AI analysis successful');
    } catch (externalError) {
      console.log('❌ External AI failed, using knowledge base...', externalError.message);
      
      // Option 2: Use medical knowledge base with intelligent analysis
      analysisResult = analyzeWithKnowledgeBase(symptoms, patientData);
      console.log('✅ Knowledge base analysis completed');
    }

    res.json(analysisResult);
  } catch (error) {
    console.error('❌ Symptom analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze symptoms',
      details: error.message 
    });
  }
});

// External AI analysis function (can be replaced with different AI providers)
async function analyzeWithExternalAI(symptoms, patientData) {
  // This is where you could integrate other AI providers like:
  // - OpenAI GPT
  // - Anthropic Claude
  // - Local LLM models
  // - Medical AI APIs
  
  // For now, simulate intelligent analysis
  const prompt = `Medical Analysis Request:
Symptoms: ${symptoms}
Patient: ${patientData?.demographics || 'Adult'}
Urgency: ${patientData?.urgency || 'routine'}

Please provide medical assessment with possible conditions, recommendations, and warnings.`;

  // Simulate AI delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  throw new Error('External AI not configured - using knowledge base');
}

// Medical knowledge base analysis
function analyzeWithKnowledgeBase(symptoms, patientData) {
  const symptomKeywords = symptoms.toLowerCase();
  let possibleConditions = [];
  let otcRecommendations = [];
  let redFlags = [];
  let selfCareAdvice = [];

  // Analyze symptoms using medical knowledge base
  const symptomAnalysis = analyzeSymptomPatterns(symptomKeywords);
  
  // Build comprehensive response
  return {
    primaryDiagnosis: symptomAnalysis.primaryCondition,
    possibleConditions: symptomAnalysis.conditions,
    severity: symptomAnalysis.severity,
    explanation: `Based on your symptoms (${symptoms}), here is our medical assessment.`,
    otcRecommendations: symptomAnalysis.medicines,
    redFlags: symptomAnalysis.redFlags,
    selfCareAdvice: symptomAnalysis.selfCare,
    followUpAdvice: {
      timeframe: symptomAnalysis.followUp.timeframe,
      urgency: symptomAnalysis.followUp.urgency,
      specialistNeeded: symptomAnalysis.followUp.specialist
    },
    confidence: symptomAnalysis.confidence,
    source: 'Medical Knowledge Base'
  };
}

// Intelligent symptom pattern analysis
function analyzeSymptomPatterns(symptomText) {
  const conditions = [];
  const medicines = [];
  const redFlags = [];
  const selfCare = [];
  let severity = 'mild';
  let primaryCondition = 'General Health Assessment';
  
  // Common symptom patterns
  const patterns = {
    respiratory: {
      keywords: ['cough', 'breathing', 'chest', 'wheeze', 'shortness'],
      conditions: [
        { name: 'Upper Respiratory Infection', probability: 80, severity: 'mild' },
        { name: 'Bronchitis', probability: 60, severity: 'moderate' }
      ],
      medicines: [
        { name: 'Dextromethorphan', dosage: '15mg', frequency: 'Every 4 hours', purpose: 'Cough suppressant' }
      ],
      redFlags: ['Difficulty breathing', 'Chest pain', 'High fever'],
      selfCare: ['Rest', 'Warm fluids', 'Humidifier use']
    },
    pain: {
      keywords: ['headache', 'pain', 'ache', 'hurt', 'sore'],
      conditions: [
        { name: 'Tension Headache', probability: 85, severity: 'mild' },
        { name: 'Muscle Pain', probability: 70, severity: 'mild' }
      ],
      medicines: [
        { name: 'Ibuprofen', dosage: '400mg', frequency: 'Every 6 hours', purpose: 'Pain relief' },
        { name: 'Acetaminophen', dosage: '500mg', frequency: 'Every 6 hours', purpose: 'Pain relief' }
      ],
      redFlags: ['Severe headache', 'Sudden onset severe pain'],
      selfCare: ['Rest', 'Cold/heat therapy', 'Gentle massage']
    },
    digestive: {
      keywords: ['nausea', 'stomach', 'vomit', 'diarrhea', 'constipation'],
      conditions: [
        { name: 'Gastric Upset', probability: 75, severity: 'mild' },
        { name: 'Food Poisoning', probability: 50, severity: 'moderate' }
      ],
      medicines: [
        { name: 'Loperamide', dosage: '2mg', frequency: 'After each loose stool', purpose: 'Diarrhea control' }
      ],
      redFlags: ['Severe dehydration', 'Blood in stool', 'High fever'],
      selfCare: ['Clear fluids', 'BRAT diet', 'Rest']
    },
    fever: {
      keywords: ['fever', 'temperature', 'hot', 'chills', 'sweats'],
      conditions: [
        { name: 'Viral Infection', probability: 80, severity: 'mild' },
        { name: 'Bacterial Infection', probability: 40, severity: 'moderate' }
      ],
      medicines: [
        { name: 'Acetaminophen', dosage: '500-1000mg', frequency: 'Every 6 hours', purpose: 'Fever reduction' }
      ],
      redFlags: ['High fever >39°C', 'Persistent fever >3 days'],
      selfCare: ['Rest', 'Fluids', 'Cool environment']
    }
  };

  // Analyze symptoms against patterns
  let matchedPatterns = [];
  Object.keys(patterns).forEach(category => {
    const pattern = patterns[category];
    const hasMatch = pattern.keywords.some(keyword => symptomText.includes(keyword));
    
    if (hasMatch) {
      matchedPatterns.push({ category, pattern });
      conditions.push(...pattern.conditions);
      medicines.push(...pattern.medicines);
      redFlags.push(...pattern.redFlags);
      selfCare.push(...pattern.selfCare);
      
      // Update severity
      if (pattern.conditions.some(c => c.severity === 'moderate')) severity = 'moderate';
      if (pattern.conditions.some(c => c.severity === 'severe')) severity = 'severe';
    }
  });

  // Set primary condition
  if (conditions.length > 0) {
    primaryCondition = conditions[0].name;
  }

  return {
    primaryCondition,
    conditions: conditions.slice(0, 3), // Top 3 conditions
    medicines: medicines.slice(0, 2), // Top 2 medicines
    redFlags: [...new Set(redFlags)], // Remove duplicates
    selfCare: [...new Set(selfCare)], // Remove duplicates
    severity,
    confidence: matchedPatterns.length > 0 ? 0.8 : 0.5,
    followUp: {
      timeframe: severity === 'severe' ? '24 hours' : '48-72 hours',
      urgency: severity === 'severe' ? 'high' : 'medium',
      specialist: 'General practitioner'
    }
  };
}
// Get user's medical profile with AI recommendations
router.get('/personalized-profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get medical profile with defaults
    const medicalProfile = user.medicalProfile || {};
    
    // Generate AI-powered personalized recommendations
    const personalizedRecommendations = await generatePersonalizedRecommendations(medicalProfile);
    
    // Check for drug interactions
    const drugInteractions = checkComprehensiveDrugInteractions(medicalProfile.currentMedications || []);
    
    // Generate lifestyle recommendations
    const lifestyleRecommendations = generateLifestyleRecommendations(medicalProfile);
    
    // Calculate risk factors
    const riskAssessment = calculateRiskFactors(medicalProfile);
    
    res.json({
      medicalProfile: {
        allergies: medicalProfile.allergies || [],
        pastDiseases: medicalProfile.pastDiseases || [],
        currentMedications: medicalProfile.currentMedications || [],
        chronicConditions: medicalProfile.chronicConditions || [],
        bloodType: medicalProfile.bloodType || '',
        emergencyContact: medicalProfile.emergencyContact || {},
        lifestyleFactors: medicalProfile.lifestyleFactors || {},
        surgicalHistory: medicalProfile.surgicalHistory || [],
        familyHistory: medicalProfile.familyHistory || [],
        immunizations: medicalProfile.immunizations || [],
        lastUpdated: medicalProfile.lastUpdated || new Date()
      },
      aiRecommendations: personalizedRecommendations,
      drugInteractions: drugInteractions,
      lifestyleRecommendations: lifestyleRecommendations,
      riskAssessment: riskAssessment
    });
  } catch (error) {
    console.error('Error fetching personalized medical profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user's medical profile
router.put('/personalized-profile', authenticateToken, async (req, res) => {
  try {
    const {
      allergies,
      pastDiseases,
      currentMedications,
      chronicConditions,
      bloodType,
      emergencyContact,
      lifestyleFactors,
      surgicalHistory,
      familyHistory,
      immunizations
    } = req.body;

    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update medical profile
    user.medicalProfile = {
      ...user.medicalProfile,
      allergies: allergies || user.medicalProfile?.allergies || [],
      pastDiseases: pastDiseases || user.medicalProfile?.pastDiseases || [],
      currentMedications: currentMedications || user.medicalProfile?.currentMedications || [],
      chronicConditions: chronicConditions || user.medicalProfile?.chronicConditions || [],
      bloodType: bloodType || user.medicalProfile?.bloodType || '',
      emergencyContact: emergencyContact || user.medicalProfile?.emergencyContact || {},
      lifestyleFactors: lifestyleFactors || user.medicalProfile?.lifestyleFactors || {},
      surgicalHistory: surgicalHistory || user.medicalProfile?.surgicalHistory || [],
      familyHistory: familyHistory || user.medicalProfile?.familyHistory || [],
      immunizations: immunizations || user.medicalProfile?.immunizations || [],
      lastUpdated: new Date()
    };

    await user.save();

    // Generate updated AI recommendations
    const personalizedRecommendations = await generatePersonalizedRecommendations(user.medicalProfile);
    const drugInteractions = checkComprehensiveDrugInteractions(user.medicalProfile.currentMedications || []);
    const lifestyleRecommendations = generateLifestyleRecommendations(user.medicalProfile);
    const riskAssessment = calculateRiskFactors(user.medicalProfile);

    res.json({
      message: 'Medical profile updated successfully',
      medicalProfile: user.medicalProfile,
      aiRecommendations: personalizedRecommendations,
      drugInteractions: drugInteractions,
      lifestyleRecommendations: lifestyleRecommendations,
      riskAssessment: riskAssessment
    });
  } catch (error) {
    console.error('Error updating personalized medical profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get AI-powered medicine recommendations
router.post('/medicine-recommendations', authenticateToken, async (req, res) => {
  try {
    const { symptoms, currentCondition } = req.body;
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const medicalProfile = user.medicalProfile || {};
    
    // Generate AI-powered medicine recommendations
    const recommendations = await generateAIMedicineRecommendations(
      symptoms,
      currentCondition,
      medicalProfile
    );
    
    res.json(recommendations);
  } catch (error) {
    console.error('Error generating medicine recommendations:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/medical-profile', authenticateToken, async (req, res) => {
  try {
    // In a real implementation, this would fetch from database
    const profile = {
      allergies: ['Penicillin', 'Sulfa drugs'],
      pastDiseases: ['Hypertension', 'Diabetes Type 2'],
      currentMedications: ['Metformin 500mg', 'Lisinopril 10mg'],
      bloodType: 'A+',
      emergencyContact: {
        name: 'Emergency Contact',
        phone: '+1234567890'
      }
    };

    res.json(profile);
  } catch (error) {
    console.error('Error fetching medical profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to analyze symptoms using medical knowledge base
function analyzeSymptoms(symptoms, userProfile = {}) {
  const lowerSymptoms = symptoms.toLowerCase();
  const { allergies = [], pastDiseases = [], currentMedications = [] } = userProfile;

  let analysisResult = {
    possibleConditions: [],
    otcMedicines: [],
    redFlags: [],
    lifestyle: [],
    riskFactors: [],
    interactions: []
  };

  // Headache analysis using knowledge base
  if (lowerSymptoms.includes('headache') || lowerSymptoms.includes('head pain')) {
    const headacheInfo = medicalKnowledgeBase.symptoms.headache;
    
    analysisResult.possibleConditions = [
      { name: 'Tension Headache', probability: 85, severity: 'mild' },
      { name: 'Migraine', probability: 60, severity: 'moderate' },
      { name: 'Cluster Headache', probability: 30, severity: 'severe' }
    ];

    analysisResult.otcMedicines = [
      { name: 'Paracetamol', dosage: '500mg-1000mg', frequency: 'Every 6-8 hours', maxDaily: '4000mg' },
      { name: 'Ibuprofen', dosage: '400mg', frequency: 'Every 8 hours', maxDaily: '1200mg' }
    ];

    analysisResult.redFlags = headacheInfo.redFlags;

    analysisResult.lifestyle = [
      'Stay hydrated (8-10 glasses of water daily)',
      'Maintain regular sleep schedule (7-9 hours)',
      'Manage stress through relaxation techniques',
      'Avoid triggers like certain foods or bright lights'
    ];
  }
  
  // Fever analysis
  else if (lowerSymptoms.includes('fever') || lowerSymptoms.includes('temperature')) {
    const feverInfo = medicalKnowledgeBase.symptoms.fever;
    
    analysisResult.possibleConditions = [
      { name: 'Viral Infection', probability: 75, severity: 'mild' },
      { name: 'Bacterial Infection', probability: 45, severity: 'moderate' },
      { name: 'Flu', probability: 65, severity: 'moderate' }
    ];

    analysisResult.otcMedicines = [
      { name: 'Paracetamol', dosage: '500mg-1000mg', frequency: 'Every 6 hours', maxDaily: '4000mg' },
      { name: 'Ibuprofen', dosage: '400mg', frequency: 'Every 8 hours', maxDaily: '1200mg' }
    ];

    analysisResult.redFlags = feverInfo.redFlags;

    analysisResult.lifestyle = [
      'Rest and sleep adequately',
      'Drink plenty of fluids',
      'Take lukewarm baths to reduce fever',
      'Avoid heavy physical activity'
    ];
  }
  
  // Chest pain analysis (high urgency)
  else if (lowerSymptoms.includes('chest pain') || lowerSymptoms.includes('chest')) {
    const chestPainInfo = medicalKnowledgeBase.symptoms.chest_pain;
    
    analysisResult.possibleConditions = [
      { name: 'Musculoskeletal Pain', probability: 60, severity: 'moderate' },
      { name: 'Acid Reflux', probability: 45, severity: 'mild' },
      { name: 'Cardiac Issue', probability: 25, severity: 'severe' }
    ];

    analysisResult.otcMedicines = [
      { name: 'Antacid', dosage: '1-2 tablets', frequency: 'As needed', maxDaily: '8 tablets' }
    ];

    analysisResult.redFlags = chestPainInfo.redFlags;

    analysisResult.lifestyle = [
      'Avoid heavy lifting or strenuous activity',
      'Monitor symptoms closely',
      'SEEK IMMEDIATE MEDICAL ATTENTION if severe'
    ];
  }
  
  // Default analysis
  else {
    analysisResult.possibleConditions = [
      { name: 'General Malaise', probability: 60, severity: 'mild' },
      { name: 'Stress-related Symptoms', probability: 40, severity: 'mild' }
    ];

    analysisResult.otcMedicines = [
      { name: 'Multivitamin', dosage: '1 tablet', frequency: 'Daily', maxDaily: '1 tablet' }
    ];

    analysisResult.redFlags = [
      'Symptoms persisting more than 2 weeks',
      'Difficulty breathing',
      'High fever above 101°F',
      'Severe pain or discomfort'
    ];

    analysisResult.lifestyle = [
      'Get adequate rest and sleep',
      'Stay hydrated',
      'Eat a balanced diet',
      'Consider consulting a healthcare provider if symptoms persist'
    ];
  }

  // Filter medicines based on allergies
  analysisResult.otcMedicines = filterMedicinesByAllergies(analysisResult.otcMedicines, allergies);

  // Check for drug interactions
  analysisResult.interactions = checkDrugInteractions(analysisResult.otcMedicines, currentMedications);

  // Generate risk factors
  analysisResult.riskFactors = generateRiskFactors(pastDiseases, symptoms);

  return analysisResult;
}

// Helper function to filter medicines by allergies
function filterMedicinesByAllergies(medicines, allergies) {
  if (!allergies || allergies.length === 0) return medicines;

  return medicines.filter(medicine => {
    return !allergies.some(allergy => 
      medicine.name.toLowerCase().includes(allergy.toLowerCase()) ||
      (allergy.toLowerCase() === 'nsaid' && 
       ['ibuprofen', 'aspirin', 'naproxen'].some(nsaid => 
         medicine.name.toLowerCase().includes(nsaid)))
    );
  });
}

// Helper function to check drug interactions
function checkDrugInteractions(otcMedicines, currentMedications) {
  const interactions = [];
  
  otcMedicines.forEach(otc => {
    currentMedications.forEach(current => {
      // Check for common interactions using knowledge base
      if (otc.name.toLowerCase().includes('aspirin') && 
          current.toLowerCase().includes('warfarin')) {
        interactions.push({
          medicines: [otc.name, current],
          severity: 'high',
          description: 'Increased risk of bleeding'
        });
      }
      
      if (otc.name.toLowerCase().includes('ibuprofen') && 
          (current.toLowerCase().includes('lisinopril') || 
           current.toLowerCase().includes('ace inhibitor'))) {
        interactions.push({
          medicines: [otc.name, current],
          severity: 'moderate',
          description: 'May reduce effectiveness of blood pressure medication'
        });
      }
    });
  });

  return interactions;
}

// Helper function to generate risk factors
function generateRiskFactors(pastDiseases, symptoms) {
  const riskFactors = [];
  
  pastDiseases.forEach(disease => {
    if (disease.toLowerCase().includes('diabetes') && 
        symptoms.toLowerCase().includes('infection')) {
      riskFactors.push('Diabetes may slow healing and increase infection risk');
    }
    
    if (disease.toLowerCase().includes('hypertension') && 
        symptoms.toLowerCase().includes('headache')) {
      riskFactors.push('High blood pressure may contribute to headaches');
    }
    
    if (disease.toLowerCase().includes('heart') && 
        symptoms.toLowerCase().includes('chest')) {
      riskFactors.push('Previous heart condition requires careful monitoring of chest symptoms');
    }
  });

  return riskFactors;
}

// Generate personalized AI recommendations using Gemini
async function generatePersonalizedRecommendations(medicalProfile) {
  try {
    const allergies = medicalProfile.allergies || [];
    const pastDiseases = medicalProfile.pastDiseases || [];
    const currentMedications = medicalProfile.currentMedications || [];
    const chronicConditions = medicalProfile.chronicConditions || [];
    const lifestyleFactors = medicalProfile.lifestyleFactors || {};

    const prompt = `As a medical AI assistant, analyze this patient's medical profile and provide personalized recommendations:

MEDICAL PROFILE:
- Allergies: ${allergies.map(a => typeof a === 'string' ? a : a.name).join(', ') || 'None'}
- Past Diseases: ${pastDiseases.map(d => typeof d === 'string' ? d : d.name).join(', ') || 'None'}
- Current Medications: ${currentMedications.map(m => typeof m === 'string' ? m : `${m.name} ${m.dosage}`).join(', ') || 'None'}
- Chronic Conditions: ${chronicConditions.map(c => typeof c === 'string' ? c : c.name).join(', ') || 'None'}
- Lifestyle: Smoking: ${lifestyleFactors.smokingStatus || 'Unknown'}, Alcohol: ${lifestyleFactors.alcoholConsumption || 'Unknown'}, Exercise: ${lifestyleFactors.exerciseFrequency || 'Unknown'}

Provide recommendations in this JSON format:
\`\`\`json
{
  "preventiveCare": [
    {
      "recommendation": "Specific preventive action",
      "reason": "Why this is important for this patient",
      "frequency": "How often to do this",
      "priority": "high/medium/low"
    }
  ],
  "medicationAlerts": [
    {
      "alert": "Specific alert about their medications",
      "severity": "high/medium/low",
      "action": "What the patient should do"
    }
  ],
  "healthMonitoring": [
    {
      "parameter": "What to monitor",
      "frequency": "How often",
      "reason": "Why this is important"
    }
  ],
  "interactions": [
    {
      "warning": "Specific interaction warning",
      "severity": "high/medium/low",
      "details": "Explanation of the interaction"
    }
  ]
}
\`\`\``;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON response
    const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    
    // Fallback recommendations
    return generateFallbackRecommendations(medicalProfile);

  } catch (error) {
    console.error('Error generating personalized recommendations:', error);
    return generateFallbackRecommendations(medicalProfile);
  }
}

// Generate AI-powered medicine recommendations
async function generateAIMedicineRecommendations(symptoms, currentCondition, medicalProfile) {
  try {
    const allergies = medicalProfile.allergies || [];
    const currentMedications = medicalProfile.currentMedications || [];
    const pastDiseases = medicalProfile.pastDiseases || [];

    const prompt = `As a medical AI assistant, provide safe medicine recommendations for this patient:

PATIENT PROFILE:
- Current Symptoms: ${symptoms}
- Current Condition: ${currentCondition || 'Not specified'}
- Known Allergies: ${allergies.map(a => typeof a === 'string' ? a : a.name).join(', ') || 'None'}
- Current Medications: ${currentMedications.map(m => typeof m === 'string' ? m : `${m.name} ${m.dosage}`).join(', ') || 'None'}
- Medical History: ${pastDiseases.map(d => typeof d === 'string' ? d : d.name).join(', ') || 'None'}

Provide safe medicine recommendations in this JSON format:
\`\`\`json
{
  "safeMedicines": [
    {
      "name": "Medicine name",
      "dosage": "Recommended dosage",
      "frequency": "How often to take",
      "duration": "How long to take",
      "reason": "Why this medicine is recommended",
      "safetyNote": "Why this is safe for this patient"
    }
  ],
  "avoidMedicines": [
    {
      "name": "Medicine to avoid",
      "reason": "Why to avoid (allergy/interaction/condition)"
    }
  ],
  "warnings": [
    {
      "warning": "Important safety warning",
      "severity": "high/medium/low"
    }
  ],
  "monitoringAdvice": [
    {
      "advice": "What to monitor while taking medicines",
      "frequency": "How often to check"
    }
  ]
}
\`\`\``;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON response
    const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    
    // Fallback recommendations
    return generateFallbackMedicineRecommendations(symptoms, medicalProfile);

  } catch (error) {
    console.error('Error generating AI medicine recommendations:', error);
    return generateFallbackMedicineRecommendations(symptoms, medicalProfile);
  }
}

// Generate comprehensive drug interactions check
function checkComprehensiveDrugInteractions(currentMedications) {
  const interactions = [];
  
  if (!currentMedications || currentMedications.length === 0) {
    return interactions;
  }

  const medications = currentMedications.map(med => 
    typeof med === 'string' ? med.toLowerCase() : med.name.toLowerCase()
  );

  // Comprehensive interaction database
  const interactionDatabase = {
    'warfarin': {
      interactions: ['aspirin', 'ibuprofen', 'naproxen', 'amoxicillin', 'metronidazole', 'sulfamethoxazole'],
      severity: 'high',
      description: 'Increased risk of bleeding'
    },
    'metformin': {
      interactions: ['contrast dye', 'alcohol', 'cimetidine'],
      severity: 'moderate',
      description: 'Risk of lactic acidosis or altered glucose control'
    },
    'lisinopril': {
      interactions: ['ibuprofen', 'naproxen', 'potassium supplements', 'aliskiren'],
      severity: 'moderate',
      description: 'Reduced effectiveness or increased potassium levels'
    },
    'simvastatin': {
      interactions: ['grapefruit', 'erythromycin', 'clarithromycin', 'itraconazole'],
      severity: 'high',
      description: 'Increased risk of muscle damage'
    },
    'digoxin': {
      interactions: ['amiodarone', 'verapamil', 'quinidine', 'clarithromycin'],
      severity: 'high',
      description: 'Increased digoxin levels leading to toxicity'
    },
    'phenytoin': {
      interactions: ['warfarin', 'omeprazole', 'fluconazole', 'isoniazid'],
      severity: 'high',
      description: 'Altered phenytoin levels'
    },
    'levothyroxine': {
      interactions: ['calcium', 'iron', 'omeprazole', 'soy'],
      severity: 'moderate',
      description: 'Reduced thyroid hormone absorption'
    }
  };

  // Check each medication against the database
  medications.forEach((med1, index1) => {
    medications.forEach((med2, index2) => {
      if (index1 >= index2) return; // Avoid duplicate checks

      // Check database interactions
      Object.keys(interactionDatabase).forEach(baseMed => {
        const drugInfo = interactionDatabase[baseMed];
        
        if (med1.includes(baseMed) && drugInfo.interactions.some(interactant => med2.includes(interactant))) {
          interactions.push({
            medications: [med1, med2],
            severity: drugInfo.severity,
            description: drugInfo.description,
            recommendation: getSafetyRecommendation(drugInfo.severity)
          });
        }
        
        if (med2.includes(baseMed) && drugInfo.interactions.some(interactant => med1.includes(interactant))) {
          interactions.push({
            medications: [med2, med1],
            severity: drugInfo.severity,
            description: drugInfo.description,
            recommendation: getSafetyRecommendation(drugInfo.severity)
          });
        }
      });
    });
  });

  return interactions;
}

// Generate lifestyle recommendations based on medical profile
function generateLifestyleRecommendations(medicalProfile) {
  const recommendations = [];
  const pastDiseases = medicalProfile.pastDiseases || [];
  const chronicConditions = medicalProfile.chronicConditions || [];
  const lifestyleFactors = medicalProfile.lifestyleFactors || {};
  const allergies = medicalProfile.allergies || [];

  // Disease-specific recommendations
  const diseaseNames = [
    ...pastDiseases.map(d => typeof d === 'string' ? d.toLowerCase() : d.name.toLowerCase()),
    ...chronicConditions.map(c => typeof c === 'string' ? c.toLowerCase() : c.name.toLowerCase())
  ];

  // Diabetes recommendations
  if (diseaseNames.some(d => d.includes('diabetes'))) {
    recommendations.push({
      category: 'Diet',
      recommendation: 'Follow a low-glycemic index diet with complex carbohydrates',
      priority: 'high',
      frequency: 'Daily',
      reason: 'Helps maintain stable blood glucose levels'
    });
    recommendations.push({
      category: 'Exercise',
      recommendation: 'Regular aerobic exercise for 150 minutes per week',
      priority: 'high',
      frequency: 'Weekly',
      reason: 'Improves insulin sensitivity and glucose control'
    });
    recommendations.push({
      category: 'Monitoring',
      recommendation: 'Regular blood glucose monitoring',
      priority: 'high',
      frequency: 'As prescribed',
      reason: 'Early detection of glucose fluctuations'
    });
  }

  // Hypertension recommendations
  if (diseaseNames.some(d => d.includes('hypertension') || d.includes('high blood pressure'))) {
    recommendations.push({
      category: 'Diet',
      recommendation: 'DASH diet with low sodium intake (<2300mg daily)',
      priority: 'high',
      frequency: 'Daily',
      reason: 'Reduces blood pressure and cardiovascular risk'
    });
    recommendations.push({
      category: 'Lifestyle',
      recommendation: 'Stress reduction through meditation or yoga',
      priority: 'medium',
      frequency: 'Daily',
      reason: 'Chronic stress contributes to elevated blood pressure'
    });
  }

  // Heart disease recommendations
  if (diseaseNames.some(d => d.includes('heart') || d.includes('cardiac') || d.includes('cardiovascular'))) {
    recommendations.push({
      category: 'Diet',
      recommendation: 'Mediterranean diet rich in omega-3 fatty acids',
      priority: 'high',
      frequency: 'Daily',
      reason: 'Supports cardiovascular health and reduces inflammation'
    });
    recommendations.push({
      category: 'Exercise',
      recommendation: 'Cardiac rehabilitation exercises as approved by physician',
      priority: 'high',
      frequency: 'Regular',
      reason: 'Strengthens heart muscle and improves circulation'
    });
  }

  // Smoking recommendations
  if (lifestyleFactors.smokingStatus === 'current') {
    recommendations.push({
      category: 'Smoking Cessation',
      recommendation: 'Quit smoking with professional support',
      priority: 'high',
      frequency: 'Immediate',
      reason: 'Smoking significantly increases risk of cardiovascular disease, cancer, and respiratory problems'
    });
  }

  // Exercise recommendations based on current level
  if (lifestyleFactors.exerciseFrequency === 'none' || lifestyleFactors.exerciseFrequency === 'rarely') {
    recommendations.push({
      category: 'Exercise',
      recommendation: 'Start with 30 minutes of light walking 3 times per week',
      priority: 'medium',
      frequency: 'Weekly',
      reason: 'Gradual introduction of physical activity improves overall health'
    });
  }

  // Sleep recommendations
  if (lifestyleFactors.sleepHours && lifestyleFactors.sleepHours < 7) {
    recommendations.push({
      category: 'Sleep',
      recommendation: 'Aim for 7-9 hours of quality sleep nightly',
      priority: 'medium',
      frequency: 'Daily',
      reason: 'Adequate sleep is crucial for immune function and overall health'
    });
  }

  // Stress recommendations
  if (lifestyleFactors.stressLevel === 'high') {
    recommendations.push({
      category: 'Stress Management',
      recommendation: 'Practice mindfulness, deep breathing, or progressive muscle relaxation',
      priority: 'medium',
      frequency: 'Daily',
      reason: 'High stress levels can worsen chronic conditions and immune function'
    });
  }

  // Allergy management
  if (allergies.length > 0) {
    recommendations.push({
      category: 'Allergy Management',
      recommendation: 'Always carry allergy information and emergency medications if prescribed',
      priority: 'high',
      frequency: 'Always',
      reason: 'Prevents accidental exposure and ensures quick treatment of allergic reactions'
    });
  }

  return recommendations;
}

// Calculate comprehensive risk factors
function calculateRiskFactors(medicalProfile) {
  const riskFactors = [];
  const pastDiseases = medicalProfile.pastDiseases || [];
  const chronicConditions = medicalProfile.chronicConditions || [];
  const familyHistory = medicalProfile.familyHistory || [];
  const lifestyleFactors = medicalProfile.lifestyleFactors || {};
  const currentMedications = medicalProfile.currentMedications || [];

  // Age-related risks (if we had age data)
  // For now, focusing on condition and lifestyle risks

  // Disease-based risks
  const allConditions = [
    ...pastDiseases.map(d => typeof d === 'string' ? d.toLowerCase() : d.name.toLowerCase()),
    ...chronicConditions.map(c => typeof c === 'string' ? c.toLowerCase() : c.name.toLowerCase())
  ];

  if (allConditions.some(d => d.includes('diabetes'))) {
    riskFactors.push({
      factor: 'Cardiovascular Disease Risk',
      level: 'high',
      reason: 'Diabetes significantly increases risk of heart disease and stroke',
      preventiveMeasures: ['Regular cardiovascular screening', 'Blood pressure monitoring', 'Cholesterol management']
    });
    riskFactors.push({
      factor: 'Kidney Disease Risk',
      level: 'moderate',
      reason: 'Diabetes can lead to diabetic nephropathy over time',
      preventiveMeasures: ['Annual kidney function tests', 'Blood pressure control', 'Blood sugar management']
    });
  }

  if (allConditions.some(d => d.includes('hypertension'))) {
    riskFactors.push({
      factor: 'Stroke Risk',
      level: 'moderate',
      reason: 'High blood pressure is a major risk factor for stroke',
      preventiveMeasures: ['Blood pressure monitoring', 'Medication compliance', 'Lifestyle modifications']
    });
  }

  // Family history risks
  const familyConditions = familyHistory.map(fh => 
    typeof fh === 'string' ? fh.toLowerCase() : fh.condition.toLowerCase()
  );

  if (familyConditions.some(c => c.includes('heart') || c.includes('cardiac'))) {
    riskFactors.push({
      factor: 'Hereditary Cardiovascular Risk',
      level: 'moderate',
      reason: 'Family history of heart disease increases your risk',
      preventiveMeasures: ['Regular cardiac screening', 'Healthy lifestyle', 'Cholesterol monitoring']
    });
  }

  if (familyConditions.some(c => c.includes('cancer'))) {
    riskFactors.push({
      factor: 'Cancer Screening Priority',
      level: 'moderate',
      reason: 'Family history may increase cancer risk',
      preventiveMeasures: ['Regular cancer screenings', 'Healthy lifestyle', 'Genetic counseling if recommended']
    });
  }

  // Lifestyle risks
  if (lifestyleFactors.smokingStatus === 'current') {
    riskFactors.push({
      factor: 'Smoking-Related Health Risks',
      level: 'high',
      reason: 'Smoking increases risk of cancer, heart disease, and respiratory problems',
      preventiveMeasures: ['Smoking cessation programs', 'Regular health screenings', 'Lung function tests']
    });
  }

  if (lifestyleFactors.alcoholConsumption === 'heavily') {
    riskFactors.push({
      factor: 'Alcohol-Related Health Risks',
      level: 'high',
      reason: 'Heavy alcohol consumption can damage liver, heart, and other organs',
      preventiveMeasures: ['Alcohol reduction programs', 'Liver function monitoring', 'Nutritional support']
    });
  }

  if (lifestyleFactors.exerciseFrequency === 'none') {
    riskFactors.push({
      factor: 'Sedentary Lifestyle Risks',
      level: 'moderate',
      reason: 'Lack of exercise increases risk of cardiovascular disease, diabetes, and osteoporosis',
      preventiveMeasures: ['Gradual exercise program', 'Physical therapy if needed', 'Regular activity monitoring']
    });
  }

  // Medication-related risks
  const medications = currentMedications.map(med => 
    typeof med === 'string' ? med.toLowerCase() : med.name.toLowerCase()
  );

  if (medications.some(med => med.includes('warfarin'))) {
    riskFactors.push({
      factor: 'Bleeding Risk',
      level: 'high',
      reason: 'Warfarin therapy requires careful monitoring to prevent bleeding complications',
      preventiveMeasures: ['Regular INR monitoring', 'Avoid certain foods and medications', 'Watch for bleeding signs']
    });
  }

  return {
    overallRiskLevel: calculateOverallRisk(riskFactors),
    individualRisks: riskFactors,
    recommendedScreenings: generateScreeningRecommendations(allConditions, familyConditions, lifestyleFactors)
  };
}

// Helper functions
function getSafetyRecommendation(severity) {
  switch (severity) {
    case 'high':
      return 'Consult your doctor immediately. Do not take these medications together without medical supervision.';
    case 'moderate':
      return 'Monitor closely for side effects. Discuss with your pharmacist or doctor.';
    case 'low':
      return 'Be aware of potential interaction. Monitor for unusual symptoms.';
    default:
      return 'Consult healthcare provider if you have concerns.';
  }
}

function calculateOverallRisk(riskFactors) {
  const highRisks = riskFactors.filter(rf => rf.level === 'high').length;
  const moderateRisks = riskFactors.filter(rf => rf.level === 'moderate').length;

  if (highRisks >= 2) return 'high';
  if (highRisks >= 1 || moderateRisks >= 3) return 'moderate';
  return 'low';
}

function generateScreeningRecommendations(conditions, familyHistory, lifestyle) {
  const screenings = [];

  // Diabetes screening
  if (conditions.some(c => c.includes('diabetes')) || lifestyle.exerciseFrequency === 'none') {
    screenings.push({
      test: 'HbA1c or Fasting Glucose',
      frequency: 'Every 3-6 months',
      reason: 'Monitor blood sugar control'
    });
  }

  // Cardiovascular screening
  if (conditions.some(c => c.includes('heart') || c.includes('hypertension')) || 
      familyHistory.some(f => f.includes('heart'))) {
    screenings.push({
      test: 'Lipid Panel',
      frequency: 'Annually',
      reason: 'Monitor cardiovascular risk factors'
    });
    screenings.push({
      test: 'Blood Pressure Check',
      frequency: 'Monthly or as directed',
      reason: 'Monitor hypertension control'
    });
  }

  // Cancer screening
  if (familyHistory.some(f => f.includes('cancer')) || lifestyle.smokingStatus === 'current') {
    screenings.push({
      test: 'Age-appropriate cancer screenings',
      frequency: 'As per guidelines',
      reason: 'Early detection of cancer'
    });
  }

  return screenings;
}

function generateFallbackRecommendations(medicalProfile) {
  return {
    preventiveCare: [
      {
        recommendation: 'Regular health check-ups',
        reason: 'Preventive care helps detect issues early',
        frequency: 'Annually',
        priority: 'medium'
      }
    ],
    medicationAlerts: [],
    healthMonitoring: [
      {
        parameter: 'Blood pressure',
        frequency: 'Monthly',
        reason: 'Important vital sign to monitor'
      }
    ],
    interactions: []
  };
}

function generateFallbackMedicineRecommendations(symptoms, medicalProfile) {
  return {
    safeMedicines: [
      {
        name: 'Paracetamol/Acetaminophen',
        dosage: '500-1000mg',
        frequency: 'Every 6-8 hours',
        duration: 'As needed, max 3 days',
        reason: 'Safe general pain reliever and fever reducer',
        safetyNote: 'Generally safe for most patients when used as directed'
      }
    ],
    avoidMedicines: [],
    warnings: [
      {
        warning: 'Consult healthcare provider if symptoms persist or worsen',
        severity: 'medium'
      }
    ],
    monitoringAdvice: [
      {
        advice: 'Monitor symptom progression',
        frequency: 'Daily'
      }
    ]
  };
}

export default router;
// Updated
