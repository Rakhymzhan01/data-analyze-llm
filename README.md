# Excel Data Analysis with LLM

A Node.js TypeScript application that allows users to upload Excel files and ask natural language questions about the data. The system uses LLM to generate Python code for data analysis and executes it to provide answers.

## Features

- **Excel File Processing**: Upload and process .xlsx/.xls files
- **Intelligent Data Conversion**: Converts Excel data to optimized format for analysis
- **Natural Language Queries**: Ask questions about your data in plain English
- **Code Generation**: Uses OpenAI GPT to generate Python/pandas code
- **Automated Execution**: Runs generated code and returns results
- **Large File Support**: Efficient processing of large Excel files

## Prerequisites

- Node.js (v16 or higher)
- Python 3.x with pandas and numpy installed
- Anthropic Claude API key

## Installation

1. Clone or download the project
2. Install Node.js dependencies:
```bash
npm install
```

3. Install Python dependencies:
```bash
pip install pandas numpy
```

4. Create a `.env` file from the example:
```bash
cp .env.example .env
```

5. Add your Anthropic Claude API key to the `.env` file:
```
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

## Usage

1. Start the development server:
```bash
npm run dev
```

2. The server will run at `http://localhost:3000`

### API Endpoints

#### Upload Excel File
```bash
POST /upload
Content-Type: multipart/form-data
Body: excelFile (file)
```

Response:
```json
{
  "id": "data_id",
  "originalName": "file.xlsx",
  "summary": "File contains 2 sheets...",
  "sheets": [...]
}
```

#### Query Data
```bash
POST /query
Content-Type: application/json
Body: {
  "dataId": "data_id",
  "question": "What is the average sales by region?"
}
```

Response:
```json
{
  "question": "What is the average sales by region?",
  "generatedCode": "# Generated Python code",
  "result": { "data": "analysis_result" }
}
```

#### Get Data Details
```bash
GET /data/:id
```

#### Health Check
```bash
GET /health
```

## Example Usage

1. Upload an Excel file with sales data
2. Ask questions like:
   - "What is the total revenue?"
   - "Show me sales by month"
   - "Which product has the highest sales?"
   - "Calculate the average order value"

The system will:
1. Generate appropriate Python/pandas code
2. Execute the code with your data
3. Return the results

## Project Structure

```
src/
├── index.ts           # Main server file
├── types.ts           # TypeScript interfaces
├── excelProcessor.ts  # Excel file processing
├── llmService.ts      # OpenAI integration
└── pythonExecutor.ts  # Python code execution

uploads/               # Temporary file uploads
temp/                  # Processed data storage
```

## How It Works

1. **File Upload**: Excel files are uploaded and processed into JSON format
2. **Data Optimization**: Large datasets are optimized for LLM processing
3. **Query Processing**: User questions are sent to Claude with data context
4. **Code Generation**: Claude generates Python/pandas code
5. **Execution**: Generated code runs with the actual data
6. **Results**: Analysis results are returned to the user

## Error Handling

The application includes comprehensive error handling for:
- Invalid file formats
- Large file processing
- Python execution errors
- API failures
- Data validation issues

## Contributing

Feel free to submit issues and enhancement requests!