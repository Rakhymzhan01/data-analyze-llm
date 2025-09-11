# How to Run and Test the Project

## Step 1: Setup and Run

1. **Install dependencies:**
```bash
npm install
```

2. **Create Python virtual environment and install dependencies:**
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install pandas numpy
```

3. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env and add your Anthropic API key
```

4. **Start the server:**
```bash
npm run dev
```

Server should start at `http://localhost:3000`

## Step 2: Test the API Endpoints

### 1. Health Check
```bash
curl http://localhost:3000/health
```
Expected response:
```json
{
  "status": "ok",
  "pythonEnvironment": "available",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Upload Excel File
Create a test Excel file or use this curl command:
```bash
curl -X POST \
  -F "excelFile=@/path/to/your/file.xlsx" \
  http://localhost:3000/upload
```

Expected response:
```json
{
  "id": "generated_id",
  "originalName": "file.xlsx",
  "summary": "File contains 1 sheet(s): Sheet1. Total rows: 100",
  "sheets": [
    {
      "name": "Sheet1",
      "rowCount": 100,
      "columnCount": 5,
      "headers": ["Name", "Age", "City", "Salary", "Department"]
    }
  ]
}
```

### 3. Query Data
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "dataId": "your_data_id_from_upload",
    "question": "What is the average salary?"
  }' \
  http://localhost:3000/query
```

Expected response:
```json
{
  "question": "What is the average salary?",
  "generatedCode": "# Calculate average salary\nresult = df_sheet1['Salary'].mean()",
  "result": 75000
}
```

### 4. Get Data Details
```bash
curl http://localhost:3000/data/your_data_id
```

## Step 3: Test with Sample Excel File

Create a sample Excel file with this structure:

| Name    | Age | City      | Salary | Department |
|---------|-----|-----------|--------|------------|
| John    | 30  | New York  | 75000  | IT         |
| Alice   | 25  | Boston    | 65000  | Marketing  |
| Bob     | 35  | Chicago   | 80000  | IT         |
| Carol   | 28  | Miami     | 70000  | Sales      |

Save as `sample.xlsx` and test with these questions:
- "What is the average salary?"
- "How many people work in IT?"
- "Show me the highest salary by department"
- "What is the age distribution?"

## Step 4: Using Postman/Insomnia

1. **Import Collection:**
   Create requests for each endpoint above

2. **File Upload:**
   - Method: POST
   - URL: `http://localhost:3000/upload`
   - Body: form-data with key "excelFile" and file value

3. **Query Data:**
   - Method: POST
   - URL: `http://localhost:3000/query`
   - Headers: `Content-Type: application/json`
   - Body: JSON with dataId and question

## Common Issues and Solutions

### Server won't start:
- Check if port 3000 is available
- Verify Python virtual environment is activated
- Ensure pandas/numpy are installed in venv

### File upload fails:
- Check file size (max 50MB)
- Ensure file is .xlsx or .xls format
- Verify uploads/ directory exists

### Python execution fails:
- Run health check to verify Python environment
- Check if venv/bin/python exists
- Verify pandas/numpy installation

### LLM errors:
- Check ANTHROPIC_API_KEY in .env
- Verify API key has sufficient credits
- Check network connection

## Example Questions to Test

**Basic Statistics:**
- "What is the sum of all salaries?"
- "How many rows are in the data?"
- "What are the unique values in the Department column?"

**Filtering and Grouping:**
- "Show me all employees older than 30"
- "Group by department and show average salary"
- "Find the employee with the highest salary"

**Data Analysis:**
- "What is the correlation between age and salary?"
- "Show me salary distribution by city"
- "Calculate the median age by department"

## Debugging Tips

1. **Check server logs** for detailed error messages
2. **Use health endpoint** to verify system status
3. **Test with small files** first before large datasets
4. **Verify Python environment** with manual pandas commands