const OpenAI = require('openai');
const fs = require('fs');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Load UCF products for recommendations
 */
function loadProducts() {
  try {
    const productsPath = require('path').join(__dirname, '../data/products.json');
    const productsData = fs.readFileSync(productsPath, 'utf8');
    return JSON.parse(productsData);
  } catch (error) {
    console.error('Error loading products:', error);
    return [];
  }
}

/**
 * Analyze agricultural image (crop, soil, leaves, plants, trees) using GPT-4 Vision
 * @param {string} imagePath - Path to the agricultural image
 * @returns {Promise<Object>} - Comprehensive analysis with recommendations
 */
async function detectPlantDisease(imagePath) {
  try {
    console.log('🌿 Analyzing agricultural image using GPT-4o Vision...');

    // Load UCF products for recommendations
    const products = loadProducts();
    const productsList = products.map(p => {
      const composition = p.composition ? `N:${p.composition.N} P:${p.composition.P} K:${p.composition.K}` : (p.npk || '');
      const crops = p.crop_usage ? ` | Crops: ${p.crop_usage.join(', ')}` : '';
      const timing = p.application_timing ? ` | When: ${p.application_timing}` : (p.usage || '');
      return `- ${p.name} (${composition})${crops}\n  ${p.description}\n  ${timing}`;
    }).join('\n\n');

    // Read image file and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const imageExtension = imagePath.split('.').pop().toLowerCase();
    const mimeType = imageExtension === 'png' ? 'image/png' : 'image/jpeg';

    // Call GPT-4o Vision API (full model for accurate diagnosis)
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a senior plant pathologist and agronomist with 20+ years of experience diagnosing crop diseases, nutrient deficiencies, and pest damage from field photographs.

Your MOST CRITICAL rule: **Base every conclusion ONLY on what is visually and specifically observable in the image provided.** 

DO NOT guess or assume based on common diseases. DO NOT fill sections with generic advice if you cannot see direct evidence.

If the image is unclear, blurry, or does not have enough visible symptoms, say so honestly in the DETAILED ANALYSIS and lower the AI Confidence score below 75%.

Use your visual expertise to distinguish between:
- Nutrient deficiencies (chlorosis patterns: interveinal, marginal, tip burn)
- Fungal diseases (spots, lesions, halo patterns, sporulation)
- Bacterial diseases (water-soaked lesions, yellowing with defined margins)
- Viral diseases (mosaic, distortion, ring spots)
- Pest damage (feeding patterns, entry holes, frass)
- Environmental stress (scorching, wilting patterns, hail damage)

Always specify which exact leaves, plant parts, or field area you are observing symptoms on.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Carefully examine this agricultural photograph and produce a diagnosis report. 

CRITICAL INSTRUCTION: Describe ONLY what you can DIRECTLY SEE in the image. Quote specific visual evidence for each claim (e.g., "The interveinal chlorosis on the older lower leaves, with green veins remaining, suggests..."). Do not generate generic disease descriptions if the symptoms are not visible.

Respond EXACTLY in this WhatsApp format (keep all section headings as-is):

🌾 UCF Crop Diagnosis

IDENTIFICATION:
Crop: [Specific crop or plant type visible, or "Unknown crop" if unclear]
Issue Detected: [Specific disease/deficiency/pest issue based on visible symptoms OR "Healthy – no symptoms observed"]
AI Confidence: [50%–99% — be conservative; only go above 85% if symptoms are very clear and textbook]

DETAILED ANALYSIS:
[3–5 sentences describing exactly what you SEE in the image: leaf color changes, pattern of symptoms (which leaves, which part of leaf), lesion characteristics, tissue damage, and what the specific visual pattern indicates. Quote specific observations like "upper leaves are yellow while lower leaves are green" or "circular brown spots with yellow halo on mid-canopy leaves".]

PROBABLE CAUSES:
• [Cause 1 — directly linked to visible symptom]
• [Cause 2 — alternative or contributing cause]
• [Cause 3 — environmental or management factor]

IMMEDIATE CONTROL ACTIONS:
• [Urgent practical action 1 the farmer can do today]
• [Action 2]
• [Action 3]

TREATMENT PLAN:
[2–4 sentences: specific treatment approach, spray frequency, dosage guidance, and expected recovery time if farmer follows plan correctly.]

UCF FERTILIZER RECOMMENDATION:
[Choose 1–2 products from the UCF list that DIRECTLY address the observed deficiency or support recovery. State application rate per hectare and explain specifically how this product targets the observed symptom. If the issue is a fungal/bacterial disease and fertilizer alone won't help, state that clearly and recommend crop management instead.]

PREVENTION MEASURES:
• [Long-term prevention tip 1 specific to this issue]
• [Long-term prevention tip 2]
• [Long-term prevention tip 3]

To connect to an agronomist, reply "Expert" or "Menu" to go to main menu.

Available UCF Products:
${productsList}`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 1800,
      temperature: 0.2
    });

    const analysisText = response.choices[0].message.content;
    console.log('✅ GPT-4o Vision analysis completed');
    console.log('🔍 Full Analysis:', analysisText.substring(0, 300) + '...');

    // Extract issue/disease name from the analysis
    const issueMatch = analysisText.match(/Issue Detected:\s*(.+)/i);
    const confidenceMatch = analysisText.match(/AI Confidence:\s*(\d+)%/i);

    const issue = issueMatch ? issueMatch[1].trim() : 'Agricultural Analysis';
    const rawConfidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 80;
    const confidenceScore = Math.max(0.5, Math.min(0.99, rawConfidence / 100));

    return {
      disease: issue,
      confidence: confidenceScore,
      fullAnalysis: analysisText,
      allResults: [{ label: issue, score: confidenceScore }]
    };

  } catch (error) {
    console.error('❌ GPT-4o Vision Agricultural Analysis Error:', error.message);
    throw error;
  }
}

/**
 * Analyze soil image using GPT-4 Vision
 * @param {string} imagePath - Path to the soil image
 * @returns {Promise<Object>} - Soil analysis result
 */
async function analyzeSoilImage(imagePath) {
  try {
    console.log('🌱 Analyzing soil sample/report using GPT-4 Vision...');

    // Load UCF products for recommendations
    const products = loadProducts();
    const productsList = products.map(p => {
      const composition = p.composition ? `N:${p.composition.N} P:${p.composition.P} K:${p.composition.K}` : (p.npk || '');
      const crops = p.crop_usage ? ` | Crops: ${p.crop_usage.join(', ')}` : '';
      const timing = p.application_timing ? ` | When: ${p.application_timing}` : (p.usage || '');
      return `- ${p.name} (${composition})${crops}\n  ${p.description}\n  ${timing}`;
    }).join('\n\n');

    // Read image file and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const imageExtension = imagePath.split('.').pop().toLowerCase();
    const mimeType = imageExtension === 'png' ? 'image/png' : 'image/jpeg';

    // Call GPT-4 Vision API with soil analysis prompt
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert soil scientist and agricultural consultant for UCF Fertilizers. Analyze soil test reports, soil samples, or soil-related images and provide detailed, actionable recommendations in farmer-friendly language.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this soil image (could be a soil test report, soil sample photo, or soil condition image) and respond EXACTLY in the following WhatsApp message format:

🌱 UCF Soil Analysis Report

SOIL ASSESSMENT:
Soil Type: [Sandy/Loamy/Clay/Mixed - based on visual appearance or report]
Overall Health: [Excellent/Good/Fair/Poor]
AI Confidence: [Number between 70% and 99%]

NUTRIENT ANALYSIS:
[If this is a test report, extract the values. If it's a soil sample photo, provide general assessment based on color, texture, and appearance]
• Nitrogen (N): [Value and unit OR Low/Medium/High]
• Phosphorus (P): [Value and unit OR Low/Medium/High]
• Potassium (K): [Value and unit OR Low/Medium/High]
• pH Level: [Value OR Acidic/Neutral/Alkaline]
• Organic Matter: [Percentage OR Low/Medium/High]

DETAILED OBSERVATIONS:
[2-4 sentences describing what you observe - soil color, texture, moisture, compaction, visible issues, or test report findings]

KEY FINDINGS:
• [Finding 1 - nutrient deficiency, pH issue, or soil health concern]
• [Finding 2]
• [Finding 3]

IMMEDIATE RECOMMENDATIONS:
• [Practical action 1 the farmer can take now]
• [Practical action 2]
• [Practical action 3]

UCF FERTILIZER RECOMMENDATIONS:
[Recommend 1-3 relevant UCF products based on the soil analysis. Include application rates per hectare and explain how each product addresses specific soil needs]

SOIL IMPROVEMENT PLAN:
[2-4 sentences with a clear plan for improving soil health - amendments needed, timing, frequency, and expected results]

CROP SUITABILITY:
[Suggest 2-3 crops that would grow well in this soil type and condition, or crops to avoid]

To connect to an agronomist, reply "Expert" or "Menu" to go to main menu.

IMPORTANT RULES:
- If this is a test report, extract all visible values accurately
- If this is a soil sample photo, provide assessment based on visual characteristics
- Be specific with fertilizer recommendations and application rates
- Keep language simple and practical for smallholder farmers
- Match UCF products to the specific soil needs identified

Available UCF Products:
${productsList}`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 1800,
      temperature: 0.2
    });

    const analysisText = response.choices[0].message.content;
    console.log('✅ GPT-4o Vision soil analysis completed');
    console.log('🔍 Full Analysis:', analysisText.substring(0, 300) + '...');

    // Extract soil health from the analysis
    const healthMatch = analysisText.match(/Overall Health:\s*(.+)/i);
    const soilHealth = healthMatch ? healthMatch[1].trim() : 'Soil Analysis Complete';

    // Determine confidence score based on health assessment
    let confidenceScore = 0.85;
    if (analysisText.toLowerCase().includes('excellent')) confidenceScore = 0.95;
    else if (analysisText.toLowerCase().includes('good')) confidenceScore = 0.90;
    else if (analysisText.toLowerCase().includes('fair')) confidenceScore = 0.80;
    else if (analysisText.toLowerCase().includes('poor')) confidenceScore = 0.75;

    return {
      disease: soilHealth,
      confidence: confidenceScore,
      fullAnalysis: analysisText,
      allResults: [{ label: soilHealth, score: confidenceScore }]
    };

  } catch (error) {
    console.error('❌ GPT-4 Vision Soil Analysis Error:', error.message);
    throw error;
  }
}

/**
 * Process crop/plant image
 * @param {string} imagePath - Path to the image
 * @param {string} imageType - Type of image ('crop' or 'soil')
 * @returns {Promise<Object>} - Analysis result
 */
async function processPlantImage(imagePath, imageType = 'crop') {
  try {
    if (imageType === 'soil') {
      return await analyzeSoilImage(imagePath);
    }

    const result = await detectPlantDisease(imagePath);
    return result;

  } catch (error) {
    console.error('❌ Plant Image Processing Error:', error.message);
    throw new Error('Unable to analyze the image. Please ensure it is a clear photo of the plant/crop.');
  }
}

/**
 * Format disease name for better readability
 * @param {string} diseaseLabel - Raw disease label from model
 * @returns {string} - Formatted disease name
 */
function formatDiseaseName(diseaseLabel) {
  // Remove underscores and capitalize words
  return diseaseLabel
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

module.exports = {
  detectPlantDisease,
  analyzeSoilImage,
  processPlantImage,
  formatDiseaseName
};
