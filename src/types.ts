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

export interface QueryResponse {
  question: string;
  generatedCode: string;
  result: any;
  interpretation?: string;
  error?: string;
}