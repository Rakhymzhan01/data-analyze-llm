import express from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { ExcelProcessor } from './excelProcessor';
import { LLMService } from './llmService';
import { PythonExecutor } from './pythonExecutor';
import { QueryRequest, QueryResponse, ComparisonRequest } from './types';

dotenv.config();

const app = express();
const port = process.env.PORT || 5001;

// Debug: log the port configuration
console.log('🔧 Environment PORT:', process.env.PORT);
console.log('🚀 Using port:', port);

// CORS middleware for cross-origin requests from frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Ensure uploads directory exists
const uploadsDir = 'uploads/';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit to prevent memory issues
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  }
});

// Configure multer for multiple file uploads (comparison)
const uploadMultiple = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  }
});

const llmService = new LLMService();
const pythonExecutor = new PythonExecutor();

// Routes
app.post('/upload', upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const processedData = await ExcelProcessor.processExcelFile(
      req.file.path,
      req.file.originalname
    );

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      id: processedData.id,
      originalName: processedData.originalName,
      summary: processedData.summary,
      sheets: processedData.sheets.map(sheet => ({
        name: sheet.sheetName,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        headers: sheet.headers
      }))
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to process Excel file' });
  }
});

// New endpoint for uploading two files for comparison
app.post('/upload-comparison', uploadMultiple.array('excelFiles', 2), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length !== 2) {
      return res.status(400).json({ error: 'Exactly two Excel files are required' });
    }

    const processedFiles = [];
    
    for (const file of files) {
      const processedData = await ExcelProcessor.processExcelFile(
        file.path,
        file.originalname
      );
      processedFiles.push(processedData);
      
      // Clean up uploaded file
      fs.unlinkSync(file.path);
    }

    res.json({
      files: processedFiles.map(data => ({
        id: data.id,
        originalName: data.originalName,
        summary: data.summary,
        sheets: data.sheets.map(sheet => ({
          name: sheet.sheetName,
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
          headers: sheet.headers
        }))
      }))
    });
  } catch (error) {
    console.error('Comparison upload error:', error);
    res.status(500).json({ error: 'Failed to process Excel files for comparison' });
  }
});

app.post('/query', async (req, res) => {
  try {
    const { dataId, question }: QueryRequest = req.body;

    if (!dataId || !question) {
      return res.status(400).json({ error: 'dataId and question are required' });
    }

    console.log('🔍 Getting processed data for ID:', dataId);
    const processedData = await ExcelProcessor.getProcessedData(dataId);
    if (!processedData) {
      return res.status(404).json({ error: 'Data not found' });
    }
    console.log('✅ Data found, rows:', processedData.sheets[0]?.rowCount);

    // Generate Python code using LLM
    console.log('🤖 Generating Python code for question:', question);
    const generatedCode = await llmService.generatePythonCode(processedData, question);
    console.log('✅ Generated code length:', generatedCode.length);

    // Execute the generated code
    console.log('🐍 Executing Python analysis...');
    const result = await pythonExecutor.executeAnalysis(processedData, generatedCode);
    console.log('✅ Python execution completed, result type:', typeof result);

    // Get beautiful interpretation from LLM
    console.log('📝 Generating interpretation...');
    const interpretation = await llmService.interpretResults(question, generatedCode, result);
    console.log('✅ Interpretation generated, length:', interpretation.length);

    const response: QueryResponse = {
      question,
      generatedCode,
      result,
      interpretation
    };

    res.json(response);
  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({
      error: 'Failed to process query',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// New endpoint for comparing two files
app.post('/compare', async (req, res) => {
  try {
    const { dataId1, dataId2, question }: ComparisonRequest = req.body;

    if (!dataId1 || !dataId2 || !question) {
      return res.status(400).json({ error: 'dataId1, dataId2, and question are required' });
    }

    console.log('🔍 Getting processed data for comparison:', dataId1, dataId2);
    
    const [processedData1, processedData2] = await Promise.all([
      ExcelProcessor.getProcessedData(dataId1),
      ExcelProcessor.getProcessedData(dataId2)
    ]);

    if (!processedData1 || !processedData2) {
      return res.status(404).json({ error: 'One or both files not found' });
    }

    console.log('✅ Both files found for comparison');

    // Generate Python code for comparison using LLM
    console.log('🤖 Generating Python code for comparison:', question);
    const generatedCode = await llmService.generateComparisonCode(processedData1, processedData2, question);
    console.log('✅ Generated comparison code length:', generatedCode.length);

    // Execute the generated code
    console.log('🐍 Executing Python comparison analysis...');
    const result = await pythonExecutor.executeComparison(processedData1, processedData2, generatedCode);
    console.log('✅ Python execution completed, result type:', typeof result);

    // Get interpretation from LLM
    console.log('📝 Generating comparison interpretation...');
    const interpretation = await llmService.interpretComparisonResults(question, generatedCode, result, processedData1, processedData2);
    console.log('✅ Interpretation generated, length:', interpretation.length);

    const response: QueryResponse = {
      question,
      generatedCode,
      result,
      interpretation
    };

    res.json(response);
  } catch (error) {
    console.error('Comparison error:', error);
    res.status(500).json({
      error: 'Failed to process comparison',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/data/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const processedData = await ExcelProcessor.getProcessedData(id);
    
    if (!processedData) {
      return res.status(404).json({ error: 'Data not found' });
    }

    res.json({
      id: processedData.id,
      originalName: processedData.originalName,
      summary: processedData.summary,
      createdAt: processedData.createdAt,
      sheets: processedData.sheets.map(sheet => ({
        name: sheet.sheetName,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        headers: sheet.headers,
        sampleData: sheet.data.slice(0, 5) // First 5 rows
      }))
    });
  } catch (error) {
    console.error('Get data error:', error);
    res.status(500).json({ error: 'Failed to retrieve data' });
  }
});

app.get('/health', async (req, res) => {
  const pythonAvailable = await pythonExecutor.validatePythonEnvironment();
  
  res.json({
    status: 'ok',
    pythonEnvironment: pythonAvailable ? 'available' : 'unavailable',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    message: 'Excel Data Analysis API',
    endpoints: {
      'POST /upload': 'Upload Excel file for processing',
      'POST /upload-comparison': 'Upload two Excel files for comparison',
      'POST /query': 'Ask questions about uploaded data',
      'POST /compare': 'Compare two uploaded files',
      'GET /data/:id': 'Get processed data details',
      'GET /health': 'Check system health'
    }
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log('Make sure to set ANTHROPIC_API_KEY in your .env file');
});