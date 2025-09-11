import Anthropic from '@anthropic-ai/sdk';
import { ProcessedData } from './types';
import { ExcelProcessor } from './excelProcessor';

export class LLMService {
  private claude: Anthropic;

  constructor() {
    this.claude = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async generatePythonCode(data: ProcessedData, question: string): Promise<string> {
    const dataContext = ExcelProcessor.optimizeDataForLLM(data);
    
    const prompt = `You are a data analysis expert. Given the following dataset and user question, generate Python code using pandas to answer the question.

Dataset Information:
${dataContext}

User Question: ${question}

Requirements:
1. Use pandas for data manipulation
2. Assume the data is already loaded as pandas DataFrames
3. For sheet named "Sheet1", use variable df_sheet1, for "Sheet2" use df_sheet2, etc.
4. Generate clean, efficient code
5. Include appropriate error handling
6. End with a result variable that contains the answer
7. Add comments explaining the analysis

Generate ONLY the Python code, no explanations, no markdown formatting:

IMPORTANT: Return ONLY executable Python code. Do NOT wrap in backtick code blocks.`;

    try {
      const response = await this.claude.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1500,
        temperature: 0.1,
        system: "You are a Python data analysis expert. Generate ONLY executable Python code. Do NOT use markdown code blocks. Do NOT add explanations before or after the code. Return only the raw Python code that can be executed directly.",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      const generatedCode = response.content[0]?.type === 'text' ? response.content[0].text : '';
      
      // Clean up the generated code - remove markdown formatting
      return generatedCode
        .replace(/```python/g, '')
        .replace(/```/g, '')
        .trim();
    } catch (error) {
      console.error('Error generating Python code:', error);
      throw new Error('Failed to generate analysis code');
    }
  }

  async generateDataFrameCreationCode(data: ProcessedData): Promise<string> {
    let code = "import pandas as pd\nimport numpy as np\nfrom datetime import datetime\nimport pickle\nimport base64\n\n";
    
    for (const sheet of data.sheets) {
      const sheetVarName = `df_${sheet.sheetName.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      code += `# Create DataFrame for sheet: ${sheet.sheetName}\n`;
      
      // Create the data structure column by column to avoid JSON issues
      code += `${sheetVarName}_data = {}\n`;
      
      for (let i = 0; i < sheet.headers.length; i++) {
        const header = sheet.headers[i];
        const columnData = sheet.data.map(row => {
          const value = row[i];
          if (value === null || value === undefined || value === '') return null;
          return value;
        });
        
        // Create Python list with proper escaping
        const pythonList = '[' + columnData.map(val => {
          if (val === null) return 'None';
          if (typeof val === 'string') {
            // Handle multiline strings and special characters properly
            const escapedVal = val
              .replace(/\\/g, '\\\\')    // Escape backslashes
              .replace(/'/g, "\\'")      // Escape single quotes
              .replace(/"/g, '\\"')      // Escape double quotes
              .replace(/\n/g, '\\n')     // Escape newlines
              .replace(/\r/g, '\\r')     // Escape carriage returns
              .replace(/\t/g, '\\t');    // Escape tabs
            return `'${escapedVal}'`;
          }
          if (typeof val === 'number') return val.toString();
          if (typeof val === 'boolean') return val ? 'True' : 'False';
          // Convert everything else to string and escape it
          const escapedStr = String(val)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          return `'${escapedStr}'`;
        }).join(', ') + ']';
        
        const escapedHeader = header.replace(/'/g, "\\'");
        code += `${sheetVarName}_data['${escapedHeader}'] = ${pythonList}\n`;
      }
      
      code += `${sheetVarName} = pd.DataFrame(${sheetVarName}_data)\n\n`;
    }
    
    return code;
  }
}