---
inclusion: always
---

# QMS Agent Guidelines

## Context
Enterprise Quality Management System for automotive electronics manufacturing. Dual-track deployment (Preview/Stable) with shared PostgreSQL database. Integration with internal IMS system for production data.

## Critical Database Safety Rules

**NEVER perform destructive migrations** - Preview and Stable environments share one database:
- Forbidden: `op.drop_column()`, `op.drop_table()`, `ALTER COLUMN` type changes
- Required: All new columns must be `nullable=True` OR have `server_default`
- Rationale: Stable version code continues running during Preview deployments

**Migration checklist:**
```python
# ✅ SAFE
op.add_column('suppliers', sa.Column('rating', sa.String(), nullable=True))
op.add_column('audits', sa.Column('score', sa.Integer(), server_default='0'))

# ❌ FORBIDDEN
op.drop_column('suppliers', 'old_field')
op.alter_column('audits', 'status', type_=sa.String(50))
```

## Backend Architecture (FastAPI + Python)

**Layered structure - strictly enforce separation:**
- `app/api/v1/`: Route handlers only (HTTP request/response, validation)
- `app/services/`: Business logic (PPM calculations, IMS integration, workflow orchestration)
- `app/models/`: SQLAlchemy ORM models
- `app/schemas/`: Pydantic models for validation
- `app/core/`: Configuration, security, dependencies

**Async patterns:**
```python
# All route handlers and DB operations must be async
@router.get("/suppliers/{supplier_id}")
async def get_supplier(supplier_id: int, db: AsyncSession = Depends(get_db)):
    return await supplier_service.get_by_id(db, supplier_id)
```

**Error handling for external integrations:**
```python
try:
    ims_data = await httpx_client.get(f"{IMS_BASE_URL}/api/incoming")
except httpx.HTTPError as e:
    logger.error(f"IMS integration failed: {e}")
    raise HTTPException(status_code=503, detail="IMS系统连接失败")
```

**Naming conventions:**
- Files/modules: `snake_case` (e.g., `supplier_service.py`)
- Classes: `PascalCase` (e.g., `SupplierScorecard`)
- Functions/variables: `snake_case` (e.g., `calculate_ppm()`)

## Frontend Architecture (Vue 3 + TypeScript)

**Mobile-first responsive design:**
```vue
<!-- Every component must handle mobile breakpoints -->
<div class="w-full md:w-1/2 lg:w-1/3">
  <button class="text-sm md:text-base px-2 md:px-4">
```

**Type safety requirements:**
- NO `any` types - use `unknown` and type guards if needed
- Define interfaces in `frontend/src/types/` for all API responses
- Use Composition API with `<script setup lang="ts">`

**Component structure:**
```typescript
// frontend/src/types/supplier.ts
export interface Supplier {
  id: number;
  name: string;
  rating: 'A' | 'B' | 'C' | 'D';
  ppm: number;
}

// Component usage
const suppliers = ref<Supplier[]>([]);
```

**State management:**
- Use Pinia stores for cross-component state (user auth, permissions)
- Local `ref`/`reactive` for component-specific state

## Development Workflow

**Incremental implementation - never generate all files at once:**

1. **Database layer**: Create/update SQLAlchemy models and Alembic migration
2. **Schemas**: Define Pydantic request/response models
3. **Service layer**: Implement business logic with proper error handling
4. **API routes**: Create FastAPI endpoints with OpenAPI documentation
5. **Frontend types**: Generate TypeScript interfaces from schemas
6. **UI components**: Build Vue components with mobile-first design
7. **Integration**: Test end-to-end flow

**Before writing code, always:**
- Check existing models in `backend/app/models/`
- Review related services in `backend/app/services/`
- Verify API versioning (use `/api/v1/` prefix)
- Confirm permission requirements from product.md

## Security & Configuration

**Environment variables:**
```python
# Use Pydantic Settings, never hardcode
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    ims_api_url: str
    jwt_secret: str
    
    class Config:
        env_file = ".env"
```

**Authentication:**
- Internal users: LDAP/AD integration via `python-ldap3`
- Suppliers: JWT tokens via `python-jose`
- All endpoints require permission checks based on user role

## Quality Metrics Integration

**IMS data synchronization:**
- Scheduled tasks via Celery (daily at 02:00)
- Fetch: incoming batches, defect counts, production output
- Auto-calculate: PPM, batch pass rate, FPY, 0KM/3MIS/12MIS metrics

**Key formulas to implement:**
```python
# Incoming batch pass rate
batch_pass_rate = ((total_batches - ng_batches) / total_batches) * 100

# Material online defect PPM
material_ppm = (defect_count / total_incoming_qty) * 1_000_000

# Process defect rate
process_defect_rate = (process_ng_count / finished_goods_count) * 100
```

## Code Comments & Documentation

- **English**: Technical implementation, standard patterns, library usage
- **Simplified Chinese**: Business logic explanations, QMS domain concepts, workflow descriptions

Example:
```python
async def calculate_supplier_score(db: AsyncSession, supplier_id: int, month: str):
    """Calculate monthly supplier performance score.
    
    采用60分制扣分模型，根据来料质量、制程质量、配合度进行评分。
    最终转换为百分制并评定A/B/C/D等级。
    """
    base_score = 60  # 基础分60分
    # Implementation...
```

## Testing Requirements

- Write unit tests for service layer logic (pytest + pytest-asyncio)
- Mock external dependencies (IMS API, LDAP)
- Test permission boundaries
- Validate calculation formulas with known data sets

## Common Pitfalls to Avoid

1. **Don't** put business logic in route handlers
2. **Don't** use synchronous DB calls (`session.query()`)
3. **Don't** forget mobile breakpoints in UI components
4. **Don't** use `any` type in TypeScript
5. **Don't** create destructive database migrations
6. **Don't** hardcode configuration values
7. **Don't** skip error handling for IMS/LDAP calls