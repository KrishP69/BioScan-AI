# BioScan AI — Smart Face Recognition Attendance Management System

An enterprise-grade, dual-portal AI Biometric Attendance System featuring real-time face detection, descriptor vector matching, anti-spoofing liveness verification, role-based access control (RBAC), and automated college attendance analytics.

---

## Key Features

- **Dual Independent Portals**:
  - **Student Portal (`/login`)**: Self-service registration, profile management, face capture studio, dynamic face status alerts, and personal attendance metrics.
  - **Admin Portal (`/admin/login`)**: Comprehensive dashboard, biometric review queue, student roster management, course/session scheduling, live AI scanner, audit trail, and security settings.
- **Two-Step Biometric Registration**:
  1. Account registration (`/register`) with `role = 'student'` and `face_status = 'not_registered'`.
  2. Webcam face capture studio (`/student/face-registration`) submitting 128-d descriptor embeddings to an admin review queue (`pending` status).
  3. Administrator approval activates verified biometric embeddings for attendance.
- **Live AI Recognition & Anti-Spoofing**:
  - Real-time facial descriptor vector matching (Euclidean & Cosine similarity).
  - Liveness scoring to prevent photo/screen spoofing.
  - Duplicate attendance prevention for identical classes/sessions.
  - Audio-visual confirmation with instant chime and status badges.
- **Enterprise Security & RBAC**:
  - Bcrypt password hashing (`rounds=12`).
  - Cryptographically signed JWT authentication tokens.
  - Strict backend authorization middleware preventing unauthorized cross-student and admin API access.
  - System-wide immutable audit trail logging all administrative actions, logins, biometric submissions, and attendance markings.

---

## Tech Stack

- **Backend**: FastAPI (Python), SQLite (WAL mode with foreign keys), Bcrypt, PyJWT, NumPy
- **Frontend**: Vanilla JavaScript (SPA Architecture), HTML5, Modern CSS (Glassmorphic dark design system), FontAwesome 6, Google Fonts
- **AI / Biometrics**: Client-side & Server-side Facial Descriptor Vector Embedding Pipeline (128-dimensional descriptors with distance thresholds)

---

## Quick Start

### 1. Install Dependencies
```bash
pip install fastapi uvicorn bcrypt pyjwt numpy httpx pydantic
```

### 2. Run the Application
```bash
python backend/run.py
```
The server will start on: **`http://localhost:8000`**

### 3. Run the Automated Test Suite
```bash
python test_system.py
```

---

## Render Deployment Guide

This repository is pre-configured for instant zero-configuration deployment on [Render](https://render.com/).

### Option A: 1-Click Render Blueprint (Recommended)
1. Push your latest code to your GitHub repository.
2. Go to your [Render Dashboard](https://dashboard.render.com/) and click **New +** -> **Blueprint**.
3. Connect your GitHub repository (`BioScan-AI`).
4. Render will automatically detect `render.yaml` and configure the web service with all build and start commands.
5. Click **Apply** to deploy.

---

### Option B: Manual Web Service Setup on Render
1. In the Render Dashboard, click **New +** -> **Web Service**.
2. Connect your GitHub repository.
3. Configure the following service settings:
   - **Name**: `bioscan-ai` (or any custom name)
   - **Environment**: `Python`
   - **Branch**: `main`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: `Free`
4. Add Environment Variables (under **Advanced**):
   - `PYTHON_VERSION`: `3.11.0`
   - `JWT_SECRET`: *(Generate a secure random string)*
   - `DATA_DIR`: `./backend/data`
5. Click **Create Web Service**.

---

### Step 3: Keep-Alive Ping Bot (Prevents Free-Tier Sleep)

Render's free tier automatically spins down web services after **15 minutes of inactivity**, causing 50+ second cold start delays for attendees. Three solutions are pre-built to keep the system awake 24/7:

#### 1. Zero-Setup GitHub Action (Automated 24/7 Cloud Ping)
A pre-configured GitHub Actions workflow [keepalive.yml](file:///.github/workflows/keepalive.yml) runs every 12 minutes completely free on GitHub's cloud.
- In your GitHub repository, go to **Settings > Secrets and variables > Actions**.
- (Optional) Add a repository secret `RENDER_URL` with your Render URL (e.g., `https://bioscan-ai.onrender.com`). If not set, it defaults to the app URL.
- The action pings `/api/health` automatically every 12 minutes.

#### 2. Standalone Python Ping Bot ([ping_bot.py](file:///ping_bot.py))
Run locally or on any server/container to monitor and keep the service awake:
```bash
python ping_bot.py --url https://your-app.onrender.com --interval 600
```

#### 3. Automatic Server Self-Ping
If you add an environment variable `RENDER_EXTERNAL_URL` or `APP_URL` in your Render Dashboard settings (e.g. `https://your-app.onrender.com`), the backend server automatically initiates its own non-blocking keep-alive ping loop every 10 minutes on startup.

---

## Default Credentials (Demo / Development)

| Portal | Route | Credentials |
| :--- | :--- | :--- |
| **Admin Portal** | `/admin/login` | **Username**: `admin`<br>**Password**: `admin` |
| **Demo Student** | `/login` | **Email**: `priya@example.com`<br>**Password**: `student123` |
| **Student Registration** | `/register` | *Self-register any new student* |

---

## API Endpoints Overview

- **Authentication**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/admin/login`, `GET /api/auth/me`
- **Student**: `GET /api/student/dashboard`, `POST /api/student/face-register`, `GET /api/student/attendance`
- **Admin**: `GET /api/admin/dashboard`, `GET /api/admin/pending-faces`, `POST /api/admin/pending-faces/{id}/approve`, `POST /api/admin/pending-faces/{id}/reject`, `GET /api/admin/students`, `PUT /api/admin/students/{id}/status`, `DELETE /api/admin/students/{id}`, `GET /api/admin/audit-logs`, `POST /api/admin/settings/password`
- **Attendance & Sessions**: `GET /api/attendance/sessions`, `POST /api/attendance/sessions`, `PUT /api/attendance/sessions/{id}/close`, `POST /api/attendance/recognize-and-mark`, `GET /api/attendance/records`
- **Subjects**: `GET /api/subjects`, `POST /api/subjects`, `DELETE /api/subjects/{id}`

