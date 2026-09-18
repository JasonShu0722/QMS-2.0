"""
条码校验功能测试
Test Barcode Validation Functionality
"""
import pytest
from datetime import datetime
from app.schemas.barcode_validation import (
    ValidationRulesConfig,
    BarcodeValidationCreate,
    BarcodeScanRequest,
)


class TestValidationRulesConfig:
    """测试校验规则配置"""
    
    def test_valid_rules_config(self):
        """测试有效的规则配置"""
        rules = ValidationRulesConfig(
            prefix="A",
            suffix="XYZ",
            min_length=10,
            max_length=20
        )
        assert rules.prefix == "A"
        assert rules.suffix == "XYZ"
        assert rules.min_length == 10
        assert rules.max_length == 20
    
    def test_max_length_validation(self):
        """测试最大长度必须大于等于最小长度"""
        with pytest.raises(ValueError, match="max_length must be greater than or equal to min_length"):
            ValidationRulesConfig(
                min_length=20,
                max_length=10
            )


class TestBarcodeValidationCreate:
    """测试创建条码校验规则"""
    
    def test_valid_creation(self):
        """测试有效的创建请求"""
        data = BarcodeValidationCreate(
            material_code="A1234",
            validation_rules=ValidationRulesConfig(
                prefix="A",
                min_length=5,
                max_length=10
            ),
            regex_pattern=r"^A\d{4}$",
            is_unique_check=True
        )
        assert data.material_code == "A1234"
        assert data.regex_pattern == r"^A\d{4}$"
        assert data.is_unique_check is True
    
    def test_invalid_regex_pattern(self):
        """测试无效的正则表达式"""
        with pytest.raises(ValueError, match="Invalid regex pattern"):
            BarcodeValidationCreate(
                material_code="A1234",
                regex_pattern=r"[invalid(regex"  # 无效的正则表达式
            )


class TestBarcodeScanRequest:
    """测试扫码请求"""
    
    def test_valid_scan_request(self):
        """测试有效的扫码请求"""
        request = BarcodeScanRequest(
            material_code="A1234",
            barcode_content="A1234567XYZ",
            supplier_id=1,
            batch_number="BATCH001",
            device_ip="192.168.1.100"
        )
        assert request.material_code == "A1234"
        assert request.barcode_content == "A1234567XYZ"
        assert request.supplier_id == 1
        assert request.batch_number == "BATCH001"
        assert request.device_ip == "192.168.1.100"
    
    def test_minimal_scan_request(self):
        """测试最小化扫码请求（可选字段为空）"""
        request = BarcodeScanRequest(
            material_code="A1234",
            barcode_content="A1234567XYZ",
            supplier_id=1
        )
        assert request.material_code == "A1234"
        assert request.barcode_content == "A1234567XYZ"
        assert request.supplier_id == 1
        assert request.batch_number is None
        assert request.device_ip is None


# 集成测试需要数据库连接，这里仅提供单元测试
# 完整的集成测试应该在实际环境中运行

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
