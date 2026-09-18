"""
数据库模型基类
所有模型继承此基类
"""
from sqlalchemy.ext.declarative import declarative_base

# 创建 SQLAlchemy 声明式基类
Base = declarative_base()
