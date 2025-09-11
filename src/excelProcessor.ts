import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { ExcelData, ProcessedData } from './types';

export class ExcelProcessor {
  private static generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  static async processExcelFile(filePath: string, originalName: string): Promise<ProcessedData> {
    const workbook = XLSX.readFile(filePath);
    const sheets: ExcelData[] = [];

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) continue;
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (jsonData.length === 0) continue;

      const headers = jsonData[0] as string[];
      const data = jsonData.slice(1) as any[][];
      
      sheets.push({
        sheetName,
        headers,
        data,
        rowCount: data.length,
        columnCount: headers.length
      });
    }

    const processedData: ProcessedData = {
      id: this.generateId(),
      originalName,
      sheets,
      summary: this.generateSummary(sheets),
      createdAt: new Date()
    };

    // Save processed data as JSON for efficient querying
    await this.saveProcessedData(processedData);
    
    return processedData;
  }

  private static generateSummary(sheets: ExcelData[]): string {
    const totalRows = sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
    const sheetNames = sheets.map(s => s.sheetName).join(', ');
    
    return `File contains ${sheets.length} sheet(s): ${sheetNames}. Total rows: ${totalRows}`;
  }

  private static async saveProcessedData(data: ProcessedData): Promise<void> {
    const dataDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const filePath = path.join(dataDir, `${data.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  static async getProcessedData(id: string): Promise<ProcessedData | null> {
    try {
      const filePath = path.join(process.cwd(), 'temp', `${id}.json`);
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  static optimizeDataForLLM(data: ProcessedData): string {
    let result = `Dataset: ${data.originalName}\n`;
    result += `Summary: ${data.summary}\n\n`;
    
    for (const sheet of data.sheets) {
      result += `Sheet: ${sheet.sheetName}\n`;
      result += `Columns: ${sheet.headers.join(', ')}\n`;
      result += `Rows: ${sheet.rowCount}\n`;
      
      // Include sample data (first 5 rows)
      if (sheet.data.length > 0) {
        result += `Sample data:\n`;
        const sampleRows = sheet.data.slice(0, 5);
        for (const row of sampleRows) {
          result += `${row.join(', ')}\n`;
        }
      }
      result += '\n';
    }
    
    return result;
  }
}