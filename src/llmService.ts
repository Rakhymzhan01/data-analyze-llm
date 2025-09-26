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
    
    // Generate DataFrame variable names for reference
    const dataFrameNames = data.sheets.map(sheet => {
      const varName = `df_${sheet.sheetName.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`;
      return `Sheet "${sheet.sheetName}" -> Variable: ${varName}`;
    }).join('\n');
    
    const prompt = `You are a data analysis expert. Given the following dataset and user question, generate Python code using pandas to answer the question.

Dataset Information:
${dataContext}

Available DataFrames:
${dataFrameNames}

User Question: ${question}

Requirements:
1. Use pandas for data manipulation
2. The DataFrames are already loaded with the variable names shown above
3. Generate clean, efficient code with proper error handling
4. ALWAYS check if columns exist before using them
5. End with a result variable that contains the answer
6. Add comments explaining the analysis
7. CRITICAL: For large datasets, provide ONLY TOP-10 summary statistics, NO detailed data
8. MANDATORY: Use .head(10), .describe(), .value_counts().head(10), .nunique() for manageable results
9. FORBIDDEN: Never return full DataFrames, raw data, or lists with >50 items
10. CRITICAL: Use df.columns.tolist() to see available columns first

EXAMPLE SAFE CODE FOR INSIGHTS:
try:
    # First, always check what columns are available
    available_columns = df.columns.tolist()
    
    # Generate specific insights, not just basic info
    result = {
        "summary": f"Dataset has {len(df)} rows and {len(df.columns)} columns",
        "insights": []
    }
    
    # Add concrete insights based on available columns
    for col in available_columns[:5]:  # Analyze first 5 columns only
        if df[col].dtype in ['object', 'string']:
            top_values = df[col].value_counts().head(3).to_dict()
            result["insights"].append(f"Column '{col}': Top values are {list(top_values.keys())}")
        elif df[col].dtype in ['int64', 'float64']:
            result["insights"].append(f"Column '{col}': Range {df[col].min():.2f} to {df[col].max():.2f}")
    
    # Add only specific findings, not raw data
    result["total_records"] = len(df)
    result["key_columns"] = available_columns[:10]  # Max 10 column names
    
except Exception as e:
    result = {"error": f"Error analyzing dataset: {str(e)}"}

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
    
    console.log('📊 Generating DataFrame code for single file...');
    console.log(`File: ${data.originalName} (${data.sheets.length} sheets)`);
    
    for (const sheet of data.sheets) {
      console.log(`Processing sheet: ${sheet.sheetName} (${sheet.rowCount} rows)`);
      const sheetVarName = `df_${sheet.sheetName.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      // Use chunked processing for large files to prevent memory issues
      if (sheet.rowCount > 5000) {
        console.log(`⚠️ Large sheet detected (${sheet.rowCount} rows), using chunked approach for single file`);
        code += this.generateChunkedDataFrameCode(sheet, sheetVarName);
      } else {
        code += this.generateOriginalDataFrameCode(sheet, sheetVarName);
      }
    }
    
    return code;
  }

  private generateOriginalDataFrameCode(sheet: any, varName: string): string {
    let code = `# Create DataFrame for sheet: ${sheet.sheetName}\n`;
    
    // Create the data structure column by column to avoid JSON issues
    code += `${varName}_data = {}\n`;
    
    for (let i = 0; i < sheet.headers.length; i++) {
      const header = sheet.headers[i];
      const columnData = sheet.data.map((row: any) => {
        const value = row[i];
        if (value === null || value === undefined || value === '') return null;
        return value;
      });
      
      // Create Python list with proper escaping
      const pythonList = '[' + columnData.map((val: any) => {
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
      code += `${varName}_data['${escapedHeader}'] = ${pythonList}\n`;
    }
    
    code += `${varName} = pd.DataFrame(${varName}_data)\n\n`;
    
    return code;
  }

  async generateComparisonCode(data1: ProcessedData, data2: ProcessedData, question: string): Promise<string> {
    const dataContext1 = ExcelProcessor.optimizeDataForLLM(data1);
    const dataContext2 = ExcelProcessor.optimizeDataForLLM(data2);
    
    // Generate DataFrame variable names for reference
    const dataFrameNames1 = data1.sheets.map(sheet => {
      const varName = `df1_${sheet.sheetName.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`;
      return `File 1 "${data1.originalName}" Sheet "${sheet.sheetName}" -> Variable: ${varName}`;
    }).join('\n');
    
    const dataFrameNames2 = data2.sheets.map(sheet => {
      const varName = `df2_${sheet.sheetName.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`;
      return `File 2 "${data2.originalName}" Sheet "${sheet.sheetName}" -> Variable: ${varName}`;
    }).join('\n');
    
    const prompt = `You are a data analysis expert. Given two datasets and a comparison question, generate Python code using pandas to compare the files and answer the question.

First Dataset (${data1.originalName}):
${dataContext1}

Second Dataset (${data2.originalName}):
${dataContext2}

Available DataFrames:
${dataFrameNames1}
${dataFrameNames2}

User Question: ${question}

Requirements:
1. Use pandas for data manipulation and comparison
2. The DataFrames are already loaded with the variable names shown above
3. Generate clean, efficient code for comparing the two datasets
4. Include appropriate error handling with try/except blocks
5. End with a result variable that contains the comparison answer
6. Add comments explaining the comparison logic
7. Common comparisons: differences, similarities, trends, changes over time, statistical comparisons
8. IMPORTANT: Do not assume variables exist - always check before using them
9. Use basic pandas operations like .shape, .columns, .dtypes, .describe()

EXAMPLE STRUCTURE:
try:
    # Get basic info about DataFrames
    df1_info = {"shape": df1.shape, "columns": list(df1.columns)}
    df2_info = {"shape": df2.shape, "columns": list(df2.columns)}
    
    # Your analysis here
    
    result = {
        "comparison_type": "basic_comparison",
        "file1_info": df1_info,
        "file2_info": df2_info,
        "summary": "Your analysis summary here"
    }
except Exception as e:
    result = {"error": str(e), "type": "analysis_error"}

Generate ONLY the Python code, no explanations, no markdown formatting:

IMPORTANT: Return ONLY executable Python code. Do NOT wrap in backtick code blocks.`;

    try {
      const response = await this.claude.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        temperature: 0.1,
        system: "You are a Python data analysis expert specializing in file comparisons. Generate ONLY executable Python code. Do NOT use markdown code blocks. Do NOT add explanations before or after the code. Return only the raw Python code that can be executed directly.",
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
      console.error('Error generating comparison Python code:', error);
      throw new Error('Failed to generate comparison analysis code');
    }
  }

  async generateComparisonDataFrameCreationCode(data1: ProcessedData, data2: ProcessedData): Promise<string> {
    let code = "import pandas as pd\nimport numpy as np\nfrom datetime import datetime\nimport pickle\nimport base64\nimport json\n\n";
    
    console.log('📊 Generating DataFrame code for comparison...');
    console.log(`File 1: ${data1.originalName} (${data1.sheets.length} sheets)`);
    console.log(`File 2: ${data2.originalName} (${data2.sheets.length} sheets)`);
    
    // Create DataFrames for first file with df1_ prefix
    code += `# DataFrames for File 1: ${data1.originalName}\n`;
    for (const sheet of data1.sheets) {
      console.log(`Processing sheet 1: ${sheet.sheetName} (${sheet.rowCount} rows)`);
      const sheetVarName = `df1_${sheet.sheetName.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      // For large datasets, use chunked approach
      if (sheet.rowCount > 5000) {
        console.log(`⚠️ Large sheet detected (${sheet.rowCount} rows), using chunked approach`);
        code += this.generateChunkedDataFrameCode(sheet, sheetVarName);
      } else {
        code += this.generateSingleDataFrameCode(sheet, sheetVarName);
      }
    }
    
    // Create DataFrames for second file with df2_ prefix
    code += `\n# DataFrames for File 2: ${data2.originalName}\n`;
    for (const sheet of data2.sheets) {
      console.log(`Processing sheet 2: ${sheet.sheetName} (${sheet.rowCount} rows)`);
      const sheetVarName = `df2_${sheet.sheetName.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      // For large datasets, use chunked approach
      if (sheet.rowCount > 5000) {
        console.log(`⚠️ Large sheet detected (${sheet.rowCount} rows), using chunked approach`);
        code += this.generateChunkedDataFrameCode(sheet, sheetVarName);
      } else {
        code += this.generateSingleDataFrameCode(sheet, sheetVarName);
      }
    }
    
    return code;
  }

  private generateChunkedDataFrameCode(sheet: any, varName: string): string {
    const chunkSize = 3000; // Process 3000 rows at a time
    const totalRows = sheet.rowCount;
    const numChunks = Math.ceil(totalRows / chunkSize);
    
    let code = `# Create chunked DataFrame for large sheet: ${sheet.sheetName} (${totalRows} rows in ${numChunks} chunks)\n`;
    
    // Create list to store chunk DataFrames
    code += `${varName}_chunks = []\n`;
    
    // Generate chunks
    for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
      const startRow = chunkIndex * chunkSize;
      const endRow = Math.min(startRow + chunkSize, totalRows);
      const chunkData = sheet.data.slice(startRow, endRow);
      
      code += `\n# Chunk ${chunkIndex + 1}/${numChunks}: rows ${startRow + 1}-${endRow}\n`;
      code += `${varName}_chunk${chunkIndex}_data = {}\n`;
      
      // Process each column for this chunk
      for (let i = 0; i < sheet.headers.length; i++) {
        const header = sheet.headers[i];
        const columnData = chunkData.map((row: any) => {
          const value = row[i];
          if (value === null || value === undefined || value === '') return null;
          return value;
        });
        
        // Create Python list with proper escaping
        const pythonList = '[' + columnData.map((val: any) => {
          if (val === null) return 'None';
          if (typeof val === 'string') {
            const escapedVal = val
              .replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t');
            return `'${escapedVal}'`;
          }
          if (typeof val === 'number') return val.toString();
          if (typeof val === 'boolean') return val ? 'True' : 'False';
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
        code += `${varName}_chunk${chunkIndex}_data['${escapedHeader}'] = ${pythonList}\n`;
      }
      
      code += `${varName}_chunk${chunkIndex} = pd.DataFrame(${varName}_chunk${chunkIndex}_data)\n`;
      code += `${varName}_chunks.append(${varName}_chunk${chunkIndex})\n`;
    }
    
    // Combine all chunks into single DataFrame
    code += `\n# Combine all chunks into single DataFrame\n`;
    code += `${varName} = pd.concat(${varName}_chunks, ignore_index=True)\n`;
    
    // Add metadata and verify DataFrame integrity
    code += `${varName}.attrs['total_rows'] = ${totalRows}\n`;
    code += `${varName}.attrs['processed_in_chunks'] = True\n`;
    code += `${varName}.attrs['chunk_info'] = 'Processed in ${numChunks} chunks of ${chunkSize} rows each'\n`;
    
    // Debug information
    code += `print("✅ DataFrame ${varName} created successfully:")\n`;
    code += `print(f"   Shape: {${varName}.shape}")\n`;
    code += `print(f"   Columns: {list(${varName}.columns)}")\n`;
    code += `print(f"   Memory usage: {${varName}.memory_usage(deep=True).sum() / 1024 / 1024:.2f} MB")\n\n`;
    
    return code;
  }

  private generateSingleDataFrameCode(sheet: any, varName: string): string {
    let code = `# Create DataFrame for sheet: ${sheet.sheetName}\n`;
    
    // Create the data structure column by column to avoid JSON issues
    code += `${varName}_data = {}\n`;
    
    for (let i = 0; i < sheet.headers.length; i++) {
      const header = sheet.headers[i];
      const columnData = sheet.data.map((row: any) => {
        const value = row[i];
        if (value === null || value === undefined || value === '') return null;
        return value;
      });
      
      // Create Python list with proper escaping
      const pythonList = '[' + columnData.map((val: any) => {
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
      code += `${varName}_data['${escapedHeader}'] = ${pythonList}\n`;
    }
    
    code += `${varName} = pd.DataFrame(${varName}_data)\n`;
    
    // Debug information
    code += `print("✅ DataFrame ${varName} created successfully:")\n`;
    code += `print(f"   Shape: {${varName}.shape}")\n`;
    code += `print(f"   Columns: {list(${varName}.columns)}")\n\n`;
    
    return code;
  }

  async interpretComparisonResults(question: string, pythonCode: string, executionResult: any, data1: ProcessedData, data2: ProcessedData): Promise<string> {
    const prompt = `Ты - умный аналитик данных. Пользователь сравнивал два файла данных и получил результат сравнения. Твоя задача - дать ПОНЯТНЫЙ и КРАСИВЫЙ ответ на русском языке.

ВОПРОС: ${question}

СРАВНИВАЕМЫЕ ФАЙЛЫ:
Файл 1: ${data1.originalName}
Файл 2: ${data2.originalName}

РЕЗУЛЬТАТ СРАВНЕНИЯ:
${JSON.stringify(executionResult, null, 2)}

ВАЖНО:
1. Отвечай КОНКРЕТНО на вопрос пользователя о сравнении
2. Покажи ключевые различия между файлами
3. Укажи сходства, если они есть
4. Если есть числовые данные - покажи изменения в процентах или абсолютных величинах
5. Используй эмодзи для красоты: 📊 💼 🔍 📈 📉 ⚡ 🏢 ✅ ❌ 🔄
6. Структурируй ответ списками и заголовками
7. НЕ показывай технический JSON - преобразуй в читаемый вид
8. Если данных много - показывай самые важные различия

Формат ответа:
[эмодзи] Краткий ответ на вопрос о сравнении

📊 Основные различия:
• различие 1
• различие 2
• различие 3

✅ Сходства:
• сходство 1 (если есть)

📈 Статистика изменений (если применимо)

ОТВЕЧАЙ ПРОСТЫМ ТЕКСТОМ БЕЗ MARKDOWN!`;

    try {
      const response = await this.claude.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1500,
        temperature: 0.3,
        system: "Ты - аналитик данных. Объясняй результаты сравнения файлов простым, понятным языком на русском. Фокусируйся на ключевых различиях и инсайтах.",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      return response.content[0]?.type === 'text' ? response.content[0].text : "Не удалось интерпретировать результаты сравнения.";
    } catch (error) {
      console.error('Error interpreting comparison results:', error);
      return "Сравнение выполнено успешно, но не удалось создать интерпретацию.";
    }
  }

  async interpretResults(question: string, pythonCode: string, executionResult: any): Promise<string> {
    const prompt = `Ты - умный аналитик данных. Пользователь задал вопрос о тендерах и получил технические данные. Твоя задача - дать ПОНЯТНЫЙ и КРАСИВЫЙ ответ на русском языке.

ВОПРОС: ${question}

ДАННЫЕ (в формате pandas DataFrame):
${JSON.stringify(executionResult, null, 2)}

ВАЖНО:
1. Отвечай КОНКРЕТНО на вопрос пользователя с КОНКРЕТНЫМИ данными
2. Если спрашивают "найди тендеры" - покажи НАЗВАНИЯ тендеров из данных
3. Если спрашивают про количество - покажи ТОЧНЫЕ числа
4. Если спрашивают про компании - покажи КОНКРЕТНЫЕ названия компаний
5. НИКОГДА не давай общие рекомендации типа "уточните параметры"
6. ВСЕГДА показывай РЕАЛЬНЫЕ данные из файла, даже если их много
7. Используй эмодзи для красоты: 📊 💼 🔍 📈 ⚡ 🏢
8. НЕ показывай технический JSON - преобразуй в читаемый вид
9. Показывай ТОП-10 конкретных результатов, НЕ советы

Формат ответа:
[эмодзи] Краткий ответ на вопрос

📋 Основные результаты:
• пункт 1
• пункт 2
• пункт 3

📊 Дополнительная статистика (если нужна)

ОТВЕЧАЙ ПРОСТЫМ ТЕКСТОМ БЕЗ MARKDOWN!`;

    try {
      const response = await this.claude.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1500,
        temperature: 0.3,
        system: "Ты - аналитик данных. Объясняй технические результаты простым, понятным языком на русском. Фокусируйся на инсайтах и практическом значении данных.",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      });

      return response.content[0]?.type === 'text' ? response.content[0].text : "Не удалось интерпретировать результаты.";
    } catch (error) {
      console.error('Error interpreting results:', error);
      return "Анализ выполнен успешно, но не удалось создать интерпретацию.";
    }
  }
}