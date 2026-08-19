import uvicorn
import os
import sys

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting AI Face Recognition Attendance Server on http://localhost:{port}")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
