import os
import sys
import asyncio
from pathlib import Path
import httpx

# Add backend directory to sys.path to ensure 'app' modules resolve cleanly in any environment (Render, Docker, Local)
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from app.database import init_db
from app.seed import seed_database
from app.routers import auth, student, admin, subjects, attendance

app = FastAPI(
    title="AI Biometric Face Recognition Attendance System",
    description="Dual-Portal (Student & Admin) Face Recognition Attendance System with RBAC and Biometric Verification.",
    version="2.0.0"
)

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Startup lifecycle: Initialize SQLite DB and seed default admin & demo subjects
async def background_keep_alive():
    external_url = os.getenv("RENDER_EXTERNAL_URL") or os.getenv("APP_URL")
    if not external_url:
        return
    clean_url = external_url.rstrip("/") + "/api/health"
    print(f"[KeepAlive] Background ping bot enabled for: {clean_url}")
    await asyncio.sleep(120)  # Wait 2 minutes after launch
    while True:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.get(clean_url)
                print(f"[KeepAlive] Pinged {clean_url} -> Status {res.status_code}")
        except Exception as e:
            print(f"[KeepAlive Warning] Self-ping failed: {e}")
        await asyncio.sleep(600)  # Ping every 10 minutes (prevents 15m idle shutdown)

@app.on_event("startup")
async def on_startup():
    print("Initializing Database...")
    init_db()
    print("Checking Database Seed...")
    seed_database()
    print("System ready!")
    asyncio.create_task(background_keep_alive())

# Include API Routers
app.include_router(auth.router)
app.include_router(student.router)
app.include_router(admin.router)
app.include_router(subjects.router)
app.include_router(attendance.router)

# Locate Frontend Directory
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
FRONTEND_DIR.mkdir(exist_ok=True)

# Mount static files if frontend folder has subfolders
css_dir = FRONTEND_DIR / "css"
css_dir.mkdir(exist_ok=True)
js_dir = FRONTEND_DIR / "js"
js_dir.mkdir(exist_ok=True)
models_dir = FRONTEND_DIR / "models"
models_dir.mkdir(exist_ok=True)

app.mount("/css", StaticFiles(directory=str(css_dir)), name="css")
app.mount("/js", StaticFiles(directory=str(js_dir)), name="js")
app.mount("/models", StaticFiles(directory=str(models_dir)), name="models")

@app.get("/api/health")
def health_check():
    return {"status": "online", "system": "AI Face Recognition Attendance System", "version": "2.0.0"}

# SPA Fallback: Serve index.html for all non-API paths
@app.get("/{full_path:path}")
async def serve_spa(full_path: str, request: Request):
    if full_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "API endpoint not found"})
        
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse(status_code=200, content={"message": "Frontend is initializing..."})
