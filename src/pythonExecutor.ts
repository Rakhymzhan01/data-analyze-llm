import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ProcessedData } from './types';
import { LLMService } from './llmService';

export class PythonExecutor {
  private llmService: LLMService;

  constructor() {
    this.llmService = new LLMService();
  }

  async executeAnalysis(data: ProcessedData, analysisCode: string): Promise<any> {
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const scriptId = Date.now().toString();
    const scriptPath = path.join(tempDir, `analysis_${scriptId}.py`);

    try {
      // Generate DataFrame creation code
      const dataFrameCode = await this.llmService.generateDataFrameCreationCode(data);
      
      // Combine DataFrame creation with analysis code
      const fullCode = `
${dataFrameCode}

# Analysis code
${analysisCode}

# Output result
import json
if 'result' in locals():
    if hasattr(result, 'to_dict'):
        print(json.dumps(result.to_dict()))
    elif hasattr(result, 'tolist'):
        print(json.dumps(result.tolist()))
    else:
        print(json.dumps(str(result)))
else:
    print(json.dumps("No result variable found"))
`;

      // Write the Python script
      fs.writeFileSync(scriptPath, fullCode);

      // Execute the Python script
      const result = await this.runPythonScript(scriptPath);
      
      // Clean up
      fs.unlinkSync(scriptPath);
      
      return result;
    } catch (error) {
      // Clean up on error
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }
      throw error;
    }
  }

  private runPythonScript(scriptPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const python = spawn('./venv/bin/python', [scriptPath]);
      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python script failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Try to parse JSON output
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (parseError) {
          // If not JSON, return as string
          resolve(stdout.trim());
        }
      });

      python.on('error', (error) => {
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });
    });
  }

  async validatePythonEnvironment(): Promise<boolean> {
    return new Promise((resolve) => {
      const python = spawn('./venv/bin/python', ['-c', 'import pandas; import numpy; print("OK")']);
      
      python.on('close', (code) => {
        resolve(code === 0);
      });

      python.on('error', () => {
        resolve(false);
      });
    });
  }
}