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

  async executeComparison(data1: ProcessedData, data2: ProcessedData, comparisonCode: string): Promise<any> {
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const scriptId = Date.now().toString();
    const scriptPath = path.join(tempDir, `comparison_${scriptId}.py`);

    try {
      console.log('📝 Generating DataFrame creation code for comparison...');
      // Generate DataFrame creation code for both files
      const dataFrameCode = await this.llmService.generateComparisonDataFrameCreationCode(data1, data2);
      console.log('✅ DataFrame creation code generated, length:', dataFrameCode.length);
      
      // Combine DataFrame creation with comparison code
      const fullCode = `
${dataFrameCode}

# Comparison analysis code
print("🐍 Starting comparison analysis...")
${comparisonCode}

# Output result
import json
try:
    if 'result' in locals():
        print("✅ Analysis completed, formatting result...")
        if hasattr(result, 'to_dict'):
            print(json.dumps(result.to_dict()))
        elif hasattr(result, 'tolist'):
            print(json.dumps(result.tolist()))
        else:
            print(json.dumps(str(result)))
    else:
        print(json.dumps({"error": "No result variable found", "type": "analysis_error"}))
except Exception as e:
    print(json.dumps({"error": str(e), "type": "execution_error"}))
`;

      console.log('💾 Writing Python script for comparison...');
      // Write the Python script
      fs.writeFileSync(scriptPath, fullCode);
      console.log('📄 Script written to:', scriptPath);

      // Execute the Python script with extended timeout for chunked processing
      console.log('🔄 Executing comparison Python script...');
      const result = await this.runPythonScript(scriptPath, 300000); // 5 minutes for chunked processing
      console.log('✅ Python script execution completed');
      
      // Clean up
      fs.unlinkSync(scriptPath);
      
      return result;
    } catch (error) {
      console.error('❌ Error in executeComparison:', error);
      // Clean up on error
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
      }
      throw error;
    }
  }

  async executeAnalysis(data: ProcessedData, analysisCode: string): Promise<any> {
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const scriptId = Date.now().toString();
    const scriptPath = path.join(tempDir, `analysis_${scriptId}.py`);

    try {
      // Generate DataFrame creation code (now with intelligent chunking)
      const dataFrameCode = await this.llmService.generateDataFrameCreationCode(data);
      
      // Check if this is a large file that will use chunked processing
      const hasLargeSheets = data.sheets.some(sheet => sheet.rowCount > 5000);
      const timeoutMs = hasLargeSheets ? 300000 : 120000; // 5 minutes for large files, 2 minutes for small
      
      console.log(`📊 Using ${hasLargeSheets ? 'extended' : 'standard'} timeout (${timeoutMs/1000}s) for analysis`);
      
      // Combine DataFrame creation with analysis code
      const fullCode = `
${dataFrameCode}

# Analysis code
print("🐍 Starting single file analysis...")
${analysisCode}

# Output result (with size limit for large results)
import json
if 'result' in locals():
    try:
        print("✅ Analysis completed, formatting result...")
        if hasattr(result, 'to_dict'):
            result_data = result.to_dict()
        elif hasattr(result, 'tolist'):
            result_data = result.tolist()
        else:
            result_data = str(result)
        
        # Convert to JSON string and check size
        result_json = json.dumps(result_data)
        
        # If result is too large (>20KB), truncate it  
        if len(result_json) > 20000:
            print(json.dumps({
                "status": "result_too_large", 
                "size": len(result_json),
                "message": f"Result too large ({len(result_json)} chars). Please use summary statistics instead of detailed data.",
                "truncated_result": result_json[:1000] + "... [TRUNCATED]"
            }))
        else:
            print(result_json)
    except Exception as e:
        print(json.dumps({"error": f"Error formatting result: {str(e)}"}))
else:
    print(json.dumps("No result variable found"))
`;

      // Write the Python script
      fs.writeFileSync(scriptPath, fullCode);

      // Execute the Python script with appropriate timeout
      const result = await this.runPythonScript(scriptPath, timeoutMs);
      
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

  private runPythonScript(scriptPath: string, timeoutMs: number = 120000): Promise<any> {
    return new Promise((resolve, reject) => {
      const pythonCmd = process.env.NODE_ENV === 'production' ? 'python3' : './venv/bin/python';
      const python = spawn(pythonCmd, [scriptPath]);
      let stdout = '';
      let stderr = '';
      let isTimedOut = false;
      let lastOutputTime = Date.now();

      // Set timeout for long-running scripts
      const timeout = setTimeout(() => {
        isTimedOut = true;
        python.kill('SIGKILL');
        reject(new Error(`Python script execution timed out after ${timeoutMs/1000} seconds. This might be due to large data processing or infinite loops.`));
      }, timeoutMs);

      python.stdout.on('data', (data) => {
        stdout += data.toString();
        lastOutputTime = Date.now();
        const output = data.toString().trim();
        if (output) {
          console.log('📊 Python progress:', output.substring(0, 100) + (output.length > 100 ? '...' : ''));
        }
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error('⚠️ Python stderr:', data.toString());
      });

      // Monitor for hung processes (no output for too long)
      const progressMonitor = setInterval(() => {
        if (Date.now() - lastOutputTime > 60000) { // 1 minute without output
          console.warn('⏰ Python script seems hung (no output for 1 minute)');
        }
      }, 30000);

      python.on('close', (code) => {
        if (isTimedOut) return; // Already handled by timeout
        
        clearTimeout(timeout);
        clearInterval(progressMonitor);
        
        if (code !== 0) {
          reject(new Error(`Python script failed with code ${code}: ${stderr}`));
          return;
        }

        try {
          // Extract JSON from stdout (might have progress messages mixed in)
          const lines = stdout.trim().split('\n');
          let jsonResult = null;
          
          // Look for JSON output (usually the last line)
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              jsonResult = JSON.parse(lines[i]);
              break;
            } catch (e) {
              // Not JSON, continue searching
            }
          }
          
          if (jsonResult !== null) {
            resolve(jsonResult);
          } else {
            // No JSON found, return full output
            resolve(stdout.trim());
          }
        } catch (parseError) {
          console.error('❌ Failed to parse Python output as JSON:', parseError);
          console.log('📄 Raw output:', stdout.trim());
          resolve(stdout.trim());
        }
      });

      python.on('error', (error) => {
        if (isTimedOut) return; // Already handled by timeout
        clearTimeout(timeout);
        clearInterval(progressMonitor);
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });
    });
  }

  async validatePythonEnvironment(): Promise<boolean> {
    return new Promise((resolve) => {
      const pythonCmd = process.env.NODE_ENV === 'production' ? 'python3' : './venv/bin/python';
      const python = spawn(pythonCmd, ['-c', 'import pandas; import numpy; print("OK")']);
      
      python.on('close', (code) => {
        resolve(code === 0);
      });

      python.on('error', () => {
        resolve(false);
      });
    });
  }
}