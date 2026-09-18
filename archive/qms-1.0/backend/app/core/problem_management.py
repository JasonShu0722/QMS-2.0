"""
跨模块问题管理共享常量与编号工具。
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum


class ResponseMode(str, Enum):
    """问题回复形式。"""

    BRIEF = "brief"
    EIGHT_D = "eight_d"


class HandlingLevel(str, Enum):
    """问题处理复杂度。"""

    SIMPLE = "simple"
    COMPLEX = "complex"
    MAJOR = "major"


@dataclass(frozen=True)
class ProblemCategoryDefinition:
    """统一问题分类定义。"""

    key: str
    category_code: str
    subcategory_code: str
    module_key: str
    label: str


PROBLEM_CATEGORY_CATALOG: dict[str, ProblemCategoryDefinition] = {
    "CQ0": ProblemCategoryDefinition(
        key="CQ0",
        category_code="CQ",
        subcategory_code="0",
        module_key="customer_quality",
        label="0km",
    ),
    "CQ1": ProblemCategoryDefinition(
        key="CQ1",
        category_code="CQ",
        subcategory_code="1",
        module_key="customer_quality",
        label="售后",
    ),
    "PQ0": ProblemCategoryDefinition(
        key="PQ0",
        category_code="PQ",
        subcategory_code="0",
        module_key="process_quality",
        label="PCBA段",
    ),
    "PQ1": ProblemCategoryDefinition(
        key="PQ1",
        category_code="PQ",
        subcategory_code="1",
        module_key="process_quality",
        label="组装测试段",
    ),
    "IQ0": ProblemCategoryDefinition(
        key="IQ0",
        category_code="IQ",
        subcategory_code="0",
        module_key="incoming_quality",
        label="结构料",
    ),
    "IQ1": ProblemCategoryDefinition(
        key="IQ1",
        category_code="IQ",
        subcategory_code="1",
        module_key="incoming_quality",
        label="电子料",
    ),
    "DQ0": ProblemCategoryDefinition(
        key="DQ0",
        category_code="DQ",
        subcategory_code="0",
        module_key="new_product_quality",
        label="厂内试产/调试问题",
    ),
    "DQ1": ProblemCategoryDefinition(
        key="DQ1",
        category_code="DQ",
        subcategory_code="1",
        module_key="new_product_quality",
        label="客诉问题",
    ),
    "AQ0": ProblemCategoryDefinition(
        key="AQ0",
        category_code="AQ",
        subcategory_code="0",
        module_key="audit_management",
        label="体系审核 NC",
    ),
    "AQ1": ProblemCategoryDefinition(
        key="AQ1",
        category_code="AQ",
        subcategory_code="1",
        module_key="audit_management",
        label="过程审核 NC",
    ),
    "AQ2": ProblemCategoryDefinition(
        key="AQ2",
        category_code="AQ",
        subcategory_code="2",
        module_key="audit_management",
        label="产品审核 NC",
    ),
    "AQ3": ProblemCategoryDefinition(
        key="AQ3",
        category_code="AQ",
        subcategory_code="3",
        module_key="audit_management",
        label="客户审核问题",
    ),
}

ISSUE_NUMBER_PREFIX = "ZXQ"
EIGHT_D_NUMBER_PREFIX = "ZX8D"
AUDIT_TYPE_TO_PROBLEM_CATEGORY_KEY: dict[str, str] = {
    "system_audit": "AQ0",
    "process_audit": "AQ1",
    "product_audit": "AQ2",
    "customer_audit": "AQ3",
}
PROBLEM_CATEGORY_KEY_TO_AUDIT_TYPE: dict[str, str] = {
    category_key: audit_type
    for audit_type, category_key in AUDIT_TYPE_TO_PROBLEM_CATEGORY_KEY.items()
}
CUSTOMER_COMPLAINT_TYPE_TO_PROBLEM_CATEGORY_KEY: dict[str, str] = {
    "0km": "CQ0",
    "after_sales": "CQ1",
}
PROBLEM_CATEGORY_KEY_TO_CUSTOMER_COMPLAINT_TYPE: dict[str, str] = {
    category_key: complaint_type
    for complaint_type, category_key in CUSTOMER_COMPLAINT_TYPE_TO_PROBLEM_CATEGORY_KEY.items()
}
PROCESS_PROBLEM_PCBA_KEYWORDS = (
    "pcba",
    "smt",
    "dip",
    "spi",
    "aoi",
    "reflow",
    "wave",
    "焊",
    "锡",
    "贴片",
    "回流",
    "波峰",
)
PROCESS_PROBLEM_ASSEMBLY_TEST_KEYWORDS = (
    "assy",
    "assembly",
    "test",
    "fct",
    "ict",
    "burn",
    "pack",
    "组装",
    "装配",
    "测试",
    "包装",
    "老化",
    "功能",
)
INCOMING_QUALITY_STRUCTURE_KEYWORDS = (
    "housing",
    "case",
    "cover",
    "shell",
    "bracket",
    "frame",
    "metal",
    "plastic",
    "rubber",
    "screw",
    "label",
    "结构",
    "五金",
    "塑胶",
    "胶件",
    "外壳",
    "支架",
    "边框",
    "螺丝",
    "标签",
)
INCOMING_QUALITY_ELECTRONIC_KEYWORDS = (
    "pcb",
    "pcba",
    "ic",
    "chip",
    "connector",
    "wire",
    "cable",
    "fpc",
    "sensor",
    "resistor",
    "capacitor",
    "inductor",
    "mos",
    "电子",
    "电路",
    "芯片",
    "连接器",
    "线束",
    "线缆",
    "电阻",
    "电容",
    "电感",
    "传感器",
)


def get_problem_category_definition(category_key: str) -> ProblemCategoryDefinition:
    """获取分类定义，不存在时抛出异常。"""

    definition = PROBLEM_CATEGORY_CATALOG.get(category_key)
    if definition is None:
        raise ValueError(f"Unsupported problem category: {category_key}")
    return definition


def get_problem_category_by_audit_type(audit_type: str) -> ProblemCategoryDefinition:
    """Resolve the unified problem category for an audit type."""

    category_key = AUDIT_TYPE_TO_PROBLEM_CATEGORY_KEY.get(audit_type)
    if category_key is None:
        raise ValueError(f"Unsupported audit type: {audit_type}")
    return get_problem_category_definition(category_key)


def get_audit_type_by_problem_category(category_key: str) -> str:
    """Resolve the audit type for an audit-management problem category key."""

    audit_type = PROBLEM_CATEGORY_KEY_TO_AUDIT_TYPE.get(category_key)
    if audit_type is None:
        raise ValueError(f"Unsupported audit problem category: {category_key}")
    return audit_type


def get_problem_category_by_customer_complaint_type(complaint_type: str) -> ProblemCategoryDefinition:
    """Resolve the unified problem category for a customer complaint type."""

    category_key = CUSTOMER_COMPLAINT_TYPE_TO_PROBLEM_CATEGORY_KEY.get(complaint_type)
    if category_key is None:
        raise ValueError(f"Unsupported customer complaint type: {complaint_type}")
    return get_problem_category_definition(category_key)


def get_customer_complaint_type_by_problem_category(category_key: str) -> str:
    """Resolve the complaint type for a customer-quality problem category key."""

    complaint_type = PROBLEM_CATEGORY_KEY_TO_CUSTOMER_COMPLAINT_TYPE.get(category_key)
    if complaint_type is None:
        raise ValueError(f"Unsupported customer problem category: {category_key}")
    return complaint_type


def get_problem_category_by_process_context(*context_values: str | None) -> ProblemCategoryDefinition:
    """Infer the process-quality category from existing process context values.

    Current process issues do not yet persist an explicit PQ0/PQ1 stage field, so the
    unified issue center uses a lightweight compatibility inference:
    1. match explicit PCBA keywords
    2. match assembly/testing keywords
    3. default to PQ1 until a structured stage field is added
    """

    normalized_values = [str(value).strip().lower() for value in context_values if value and str(value).strip()]

    for value in normalized_values:
        if any(keyword in value for keyword in PROCESS_PROBLEM_PCBA_KEYWORDS):
            return get_problem_category_definition("PQ0")

    for value in normalized_values:
        if any(keyword in value for keyword in PROCESS_PROBLEM_ASSEMBLY_TEST_KEYWORDS):
            return get_problem_category_definition("PQ1")

    return get_problem_category_definition("PQ1")


def get_problem_category_by_trial_issue_type(issue_type: str | None = None) -> ProblemCategoryDefinition:
    """Resolve the current unified category for trial-issue records.

    Existing `TrialIssue` data only covers internal trial/debug findings, so the first
    unified issue-center slice maps them to DQ0. DQ1 remains reserved for future
    customer-sourced new-product issues once that source record exists.
    """

    _ = issue_type
    return get_problem_category_definition("DQ0")


def get_problem_category_by_scar_context(*context_values: str | None) -> ProblemCategoryDefinition:
    """Infer the incoming-quality category from currently available SCAR context.

    Existing SCAR records do not yet persist a structured IQ0/IQ1 material-class
    field. The first unified issue-center slice therefore uses a lightweight
    compatibility inference based on material code and defect description. When
    no structure-specific keyword is present, the mapping falls back to IQ1 so
    supplier issues remain filterable until the source model gains an explicit
    material-class field.
    """

    normalized_values = [str(value).strip().lower() for value in context_values if value and str(value).strip()]

    for value in normalized_values:
        if any(keyword in value for keyword in INCOMING_QUALITY_STRUCTURE_KEYWORDS):
            return get_problem_category_definition("IQ0")

    for value in normalized_values:
        if any(keyword in value for keyword in INCOMING_QUALITY_ELECTRONIC_KEYWORDS):
            return get_problem_category_definition("IQ1")

    return get_problem_category_definition("IQ1")


def build_problem_category_key(category_code: str, subcategory_code: str) -> str:
    """根据分类码与子类码拼接标准分类键。"""

    category_code = category_code.strip().upper()
    subcategory_code = subcategory_code.strip()
    category_key = f"{category_code}{subcategory_code}"
    get_problem_category_definition(category_key)
    return category_key


def default_response_mode(level: HandlingLevel) -> ResponseMode:
    """根据处理复杂度返回默认回复形式。"""

    if level == HandlingLevel.MAJOR:
        return ResponseMode.EIGHT_D
    return ResponseMode.BRIEF


def format_problem_number(
    *,
    prefix: str,
    category_key: str,
    sequence: int,
    occurred_at: date | datetime | None = None,
) -> str:
    """格式化统一问题编号。"""

    if sequence < 1 or sequence > 999:
        raise ValueError("Sequence must be between 1 and 999")

    definition = get_problem_category_definition(category_key)
    current = occurred_at or datetime.utcnow()
    if isinstance(current, datetime):
        current_date = current.date()
    else:
        current_date = current

    yymm = current_date.strftime("%y%m")
    return f"{prefix}-{definition.key}-{yymm}-{sequence:03d}"


def build_issue_number(
    category_key: str,
    sequence: int,
    occurred_at: date | datetime | None = None,
) -> str:
    """生成统一问题主单号。"""

    return format_problem_number(
        prefix=ISSUE_NUMBER_PREFIX,
        category_key=category_key,
        sequence=sequence,
        occurred_at=occurred_at,
    )


def build_8d_number(
    category_key: str,
    sequence: int,
    occurred_at: date | datetime | None = None,
) -> str:
    """生成 8D 报告号。"""

    return format_problem_number(
        prefix=EIGHT_D_NUMBER_PREFIX,
        category_key=category_key,
        sequence=sequence,
        occurred_at=occurred_at,
    )
