import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import update
from app.db.session import SessionLocal
from app.models.user import User

async def update_admin():
    async with SessionLocal() as db:
        await db.execute(update(User).where(User.username == 'admin').values(allowed_environments='stable,preview'))
        await db.commit()
    print('Admin user updated successfully via ORM.')

if __name__ == '__main__':
    asyncio.run(update_admin())
