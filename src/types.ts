export interface ExcelData {
  sheetName: string;
  headers: string[];
  data: any[][];
  rowCount: number;
  columnCount: number;
}

export interface ProcessedData {
  id: string;
  originalName: string;
  sheets: ExcelData[];
  summary: string;
  createdAt: Date;
}

export interface QueryRequest {
  dataId: string;
  question: string;
}

export interface ComparisonRequest {
  dataId1: string;
  dataId2: string;
  question: string;
}

export interface ComparisonData {
  file1: ProcessedData;
  file2: ProcessedData;
}

export interface QueryResponse {
  question: string;
  generatedCode: string;
  result: any;
  interpretation?: string;
  error?: string;
}