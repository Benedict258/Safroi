import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY || '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'
});

async function testGLM53() {
  console.log('Testing GLM-5.3 availability...');
  
  try {
    const completion = await client.chat.completions.create({
      model: 'z-ai/glm-5.3',
      messages: [
        { role: 'system', content: 'You are a legal AI assistant.' },
        { role: 'user', content: 'Which number is larger, 9.11 or 9.8?' }
      ],
      temperature: 0.5,
      max_tokens: 1024,
    });
    
    console.log('✓ GLM-5.3 is available');
    console.log('Response:', completion.choices[0].message.content);
    return true;
  } catch (err) {
    console.error('✗ GLM-5.3 failed:', err.message);
    return false;
  }
}

async function testContentSafety() {
  console.log('\nTesting nemotron-3.5-content-safety...');
  
  try {
    // Test with simple text
    const completion = await client.chat.completions.create({
      model: 'nvidia/nemotron-3.5-content-safety',
      messages: [
        {
          role: 'user',
          content: 'Is this safe? Hello world'
        }
      ],
      temperature: 0,
      max_tokens: 256,
    });
    
    console.log('✓ nemotron-3.5-content-safety is available');
    console.log('Response:', completion.choices[0].message.content);
    return true;
  } catch (err) {
    console.error('✗ nemotron-3.5-content-safety failed:', err.message);
    return false;
  }
}

async function testContractAnalysis() {
  console.log('\nTesting contract analysis with GLM-5.3...');
  
  const contractText = `
DATA PROCESSING ADDENDUM

1. DATA PROCESSING
The Processor shall process Personal Data only on documented instructions from the Controller.

2. DATA SECURITY
The Processor shall implement appropriate technical and organizational measures to ensure security of processing.

3. DATA BREACH NOTIFICATION
Processor shall notify Controller of any personal data breach without undue delay.
  `;
  
  const prompt = `
You are a legal AI assistant analyzing Terms of Service and Privacy Policies.

Task: Analyze the following contract text and provide a structured analysis.

Contract Text:
${contractText}

Output schema (JSON only, no markdown):
{
  "legal_explanation": "Detailed legal analysis in English",
  "plain_language": "Simple explanation in English",
  "impact": "One sentence impact summary in English",
  "category": "Privacy|Data|Security|Payments|Terms|Other"
}
`;

  try {
    const completion = await client.chat.completions.create({
      model: 'z-ai/glm-5.3',
      messages: [
        { role: 'system', content: 'You are a legal AI assistant specializing in contract analysis.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 8192,
    });
    
    const output = completion.choices[0].message.content;
    console.log('✓ Contract analysis successful');
    console.log('Output:', output);
    return true;
  } catch (err) {
    console.error('✗ Contract analysis failed:', err.message);
    return false;
  }
}

async function runTests() {
  console.log('=== NVIDIA NIM Pipeline Test ===\n');
  
  const glmAvailable = await testGLM53();
  const safetyAvailable = await testContentSafety();
  const analysisWorks = await testContractAnalysis();
  
  console.log('\n=== Results ===');
  console.log('GLM-5.3 available:', glmAvailable);
  console.log('Content Safety available:', safetyAvailable);
  console.log('Contract analysis works:', analysisWorks);
  
  if (glmAvailable && safetyAvailable) {
    console.log('\n✓ Pipeline ready for deployment!');
  } else {
    console.log('\n✗ Pipeline needs fixes');
  }
}

runTests().catch(console.error);
