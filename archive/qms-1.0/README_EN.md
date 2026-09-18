# QMS - Quality Management System

Enterprise-grade Quality Management System designed for the automotive electronics manufacturing industry, enabling digital transformation of the entire quality management process including supplier quality management, process quality control, and customer quality traceability.

## Project Overview

This system adopts a **Monorepo + Docker Compose** architecture, implementing **dual-track parallel operation (Preview and Stable environments)** that share a single PostgreSQL database backend.

### Core Features

- **Unified Authentication**: Supports unified login for internal employees (account password/LDAP) and external suppliers (account password + CAPTCHA)
- **Fine-grained Permission Control**: Two-dimensional permission matrix based on "function module - operation type"
- **Personalized Workbench**: Dynamically renders personalized dashboards and aggregated task lists based on user roles
- **Mobile Responsive**: Cross-device adaptation with support for on-site scanning and offline temporary storage
- **Dual-track Release Mechanism**: New features are smoothly released to the stable environment after validation in the preview environment
- **IMS System Integration**: Automatically synchronizes material incoming and production data, calculating quality metrics in real-time

## Technology Stack

### Backend
- **Language**: Python 3.10+
- **Framework**: FastAPI (high-performance asynchronous web framework)
- **Database**: PostgreSQL 15+ (primary database) + Redis 7+ (cache/queue)
- **ORM**: SQLAlchemy 2.0+ (Async)
- **Task Queue**: Celery + Redis
- **Authentication**: Python-Jose (JWT) + LDAP3 (reserved)
- **Data Validation**: Pydantic V2

### Frontend
- **Framework**: Vue 3 (Composition API) + Vite
- **UI Components**: Element Plus (desktop) + Tailwind CSS (mobile)
- **State Management**: Pinia
- **Visualization**: ECharts
- **HTTP Client**: Axios

### Infrastructure
- **Container Orchestration**: Docker Compose
- **Gateway**: Nginx (reverse proxy + routing distribution)
- **Database Migration**: Alembic

## Dual-track Release Architecture

The system distributes requests to different container instances based on domain name routing rules through Nginx:

```
User Access
  ├── qms.company.com (Stable Environment)
  │   ├── Frontend: frontend-stable
  │   └── Backend: backend-stable
  │
  └── preview.company.com (Preview Environment)
      ├── Frontend: frontend-preview
      └── Backend: backend-preview
      
Shared Data Backend
  ├── PostgreSQL (Primary Database)
  └── Redis (Cache/Queue)
```

### Architecture Benefits

1. **Zero-downtime Release**: New features are validated in the preview environment without affecting stable environment users
2. **Data Consistency**: Both environments share the same database, ensuring real-time data synchronization
3. **Gradual Testing**: Feature flags control the release scope of new features
4. **Quick Rollback**: Immediate switch back to stable version when issues are detected

### Database Compatibility Principles

To ensure stable operation of the dual-track environment, database migrations must follow the **non-destructive principle**:

✅ **Allowed Operations**:
- Add new tables
- Add new columns (must be set to `nullable=True` or have `server_default`)
- Add new indexes

❌ **Prohibited Operations**:
- Drop columns (`op.drop_column()`)
- Drop tables (`op.drop_table()`)
- Modify column types (`ALTER COLUMN`)
- Rename columns/tables

## Quick Start

### Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- Python 3.10+ (local development)
- Node.js 18+ (local development)

### Installation Steps

1. **Clone the Repository**
```bash
git clone <repository-url>
cd QMS
```

2. **Configure Environment Variables**
```bash
cp .env.example .env
# Edit the .env file and fill in actual passwords and configurations
```

3. **Start All Services**
```bash
# Build and start all containers (background mode)
docker compose up -d --build

# Check service status
docker compose ps

# View logs
docker compose logs -f backend-stable
docker compose logs -f frontend-stable
```

4. **Execute Database Migrations**
```bash
# Stable Environment
docker compose exec backend-stable alembic upgrade head

# Preview Environment
docker compose exec backend-preview alembic upgrade head
```

5. **Access the System**
- Stable Environment: http://localhost (or configured domain)
- Preview Environment: http://localhost:8081 (or configured preview domain)
- API Documentation: http://localhost/api/docs

### Local Development

#### Backend Development
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

#### Frontend Development
```bash
cd frontend
npm install
npm run dev
```

## Project Structure

```
QMS/
├── backend/                 # Backend Application
│   ├── app/
│   │   ├── api/            # API Routes
│   │   │   └── v1/         # API Version 1
│   │   ├── core/           # Core Configuration (Authentication, Permissions, Settings)
│   │   ├── models/         # SQLAlchemy Data Models
│   │   ├── schemas/        # Pydantic Data Validation Models
│   │   ├── services/       # Business Logic Layer
│   │   └── main.py         # Application Entry Point
│   ├── alembic/            # Database Migration Scripts
│   ├── tests/              # Test Cases
│   ├── requirements.txt    # Python Dependencies
│   └── Dockerfile          # Backend Container Build File
│
├── frontend/               # Frontend Application
│   ├── src/
│   │   ├── api/           # API Call Encapsulation
│   │   ├── assets/        # Static Resources
│   │   ├── components/    # Reusable Components
│   │   ├── layouts/       # Page Layouts
│   │   ├── stores/        # Pinia State Management
│   │   ├── views/         # Page Views
│   │   ├── router/        # Route Configuration
│   │   └── main.ts        # Frontend Entry Point
│   ├── package.json       # Node.js Dependencies
│   └── Dockerfile         # Frontend Container Build File
│
├── deployment/            # Deployment Configuration
│   └── nginx/
│       └── nginx.conf     # Nginx Configuration File
│
├── docker-compose.yml     # Container Orchestration Configuration
├── .env.example           # Environment Variables Template
├── .gitignore            # Git Ignore File
└── README.md             # Project Documentation
```

## Common Commands

### Docker Operations
```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# Restart specific service
docker compose restart backend-stable

# View logs
docker compose logs -f backend-stable
docker compose logs -f frontend-preview

# Enter container
docker compose exec backend-stable bash
docker compose exec postgres psql -U qms_user -d qms_db
```

### Database Operations
```bash
# Create new migration script
docker compose exec backend-stable alembic revision --autogenerate -m "description"

# Execute migration
docker compose exec backend-stable alembic upgrade head

# Rollback migration
docker compose exec backend-stable alembic downgrade -1

# View migration history
docker compose exec backend-stable alembic history
```

### Testing
```bash
# Backend testing
docker compose exec backend-stable pytest

# Frontend testing
docker compose exec frontend-stable npm run test
```

## Feature Modules

### Implemented Modules
- ✅ User Registration and Approval
- ✅ Unified Login and Authentication
- ✅ Fine-grained Permission Control
- ✅ Operation Log Audit
- ✅ Personal Center and Workbench
- ✅ Task Aggregation
- ✅ In-app Notification
- ✅ Announcement Management
- ✅ Feature Flag Control

### In Development
- 🚧 Supplier Quality Management
- 🚧 Process Quality Management
- 🚧 Customer Quality Management
- 🚧 New Product Quality Management
- 🚧 Audit Management

### Reserved Modules
- ⏸️ Instrument and Gauge Management
- ⏸️ Quality Cost Management

## Deployment Guide

### Production Environment Deployment

1. **Configure SSL Certificates**
```bash
# Place certificate files in deployment/nginx/certs/
deployment/nginx/certs/
├── qms.company.com.crt
├── qms.company.com.key
├── preview.company.com.crt
└── preview.company.com.key
```

2. **Configure Domain Resolution**
- qms.company.com → Server IP
- preview.company.com → Server IP

3. **Start Production Environment**
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Network Configuration

The system is deployed in the DMZ zone and requires dual network cards:
- **External Network Card**: Responds to frontend user requests
- **Internal Network Card**: Accesses the IMS system to obtain production data

## Security Considerations

1. **Password Policy**: Enforce password complexity (at least three of uppercase, lowercase, digits, special characters, length > 8)
2. **Login Protection**: Lock account for 30 minutes after 5 consecutive failed attempts
3. **Periodic Password Change**: Force password modification every 90 days
4. **Data Isolation**: Supplier users can only view data associated with themselves
5. **Operation Audit**: Record logs for all critical operations

## Contributing

Please refer to [CONTRIBUTING.md](CONTRIBUTING.md)

## License

[TBD]

## Contact

- Project Lead: [TBD]
- Technical Support: [TBD]
- Issue Feedback: [TBD]
