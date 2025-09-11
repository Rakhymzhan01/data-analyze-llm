import express from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { ExcelProcessor } from './excelProcessor';
import { LLMService } from './llmService';
import { PythonExecutor } from './pythonExecutor';
import { QueryRequest, QueryResponse } from './types';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
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

app.post('/query', async (req, res) => {
  try {
    const { dataId, question }: QueryRequest = req.body;

    if (!dataId || !question) {
      return res.status(400).json({ error: 'dataId and question are required' });
    }

    const processedData = await ExcelProcessor.getProcessedData(dataId);
    if (!processedData) {
      return res.status(404).json({ error: 'Data not found' });
    }

    // Generate Python code using LLM
    const generatedCode = await llmService.generatePythonCode(processedData, question);

    // Execute the generated code
    const result = await pythonExecutor.executeAnalysis(processedData, generatedCode);

    const response: QueryResponse = {
      question,
      generatedCode,
      result
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
      'POST /query': 'Ask questions about uploaded data',
      'GET /data/:id': 'Get processed data details',
      'GET /health': 'Check system health'
    }
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log('Make sure to set ANTHROPIC_API_KEY in your .env file');
});