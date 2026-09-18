"""Customer complaint API tests."""

import pytest
from httpx import AsyncClient

from app.models.customer_complaint import CustomerComplaint


def test_customer_complaint_physical_status_enums_use_database_values():
    assert CustomerComplaint.__table__.columns["physical_disposition_status"].type.enums == [
        "pending",
        "in_progress",
        "completed",
    ]
    assert CustomerComplaint.__table__.columns["physical_analysis_status"].type.enums == [
        "pending",
        "assigned",
        "completed",
    ]


@pytest.mark.asyncio
async def test_record_physical_disposition_success(async_client: AsyncClient, test_user_token: str):
    create_response = await async_client.post(
        "/api/v1/customer-complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_type": "0km",
            "customer_code": "CUST001",
            "product_type": "Housing",
            "defect_description": "\u5ba2\u6237\u9000\u4ef6\u5916\u89c2\u5f02\u5e38\u65e0\u9700\u89e3\u6790\u76f4\u63a5\u5904\u7406\u5907\u6848",
            "is_return_required": True,
            "requires_physical_analysis": False,
        },
    )
    assert create_response.status_code == 201
    complaint_id = create_response.json()["id"]

    disposition_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/physical-disposition",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "disposition_plan": "\u5b89\u6392\u9000\u4ef6\u5165\u5e93\u5e76\u6267\u884c\u590d\u5224",
            "disposition_status": "in_progress",
            "disposition_notes": "\u7b49\u5f85\u9996\u6279\u6837\u4ef6\u8fd4\u56de",
        },
    )

    assert disposition_response.status_code == 200
    data = disposition_response.json()
    assert data["physical_disposition_status"] == "in_progress"
    assert data["status"] == "pending"
    assert data["physical_disposition_plan"]


@pytest.mark.asyncio
async def test_batch_create_customer_complaints_with_basic_info(async_client: AsyncClient, test_user_token: str):
    response = await async_client.post(
        "/api/v1/customer-complaints/batch",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "items": [
                {
                    "complaint_type": "0km",
                    "customer_code": "CUST-BATCH-01",
                    "customer_name": "批量客户一",
                    "received_date": "2026-05-01",
                    "occurrence_date": "2026-04-30",
                    "production_date": "2026-04-20",
                    "product_type": "MCU",
                    "product_model": "AV010A",
                    "project_stage": "量产",
                    "batch_code": "BATCH-001",
                    "trace_code": "TRACE-001",
                    "defect_description": "客户产线发现控制器上电异常需要登记跟进",
                    "failure_count": 2,
                    "fault_category": "功能异常",
                    "analysis_priority": "P2",
                    "is_return_required": True,
                    "requires_physical_analysis": True,
                },
                {
                    "complaint_type": "after_sales",
                    "customer_code": "CUST-BATCH-02",
                    "customer_name": "批量客户二",
                    "received_date": "2026-05-02",
                    "return_month": "2026-05",
                    "occurrence_date": "2026-04-28",
                    "return_type": "零星退件",
                    "product_type": "VCU",
                    "product_model": "VCU-A",
                    "trace_code": "TRACE-002",
                    "service_months": 13,
                    "service_month_category": "12-24月",
                    "vin_code": "LGB61YEA0NS074109",
                    "mileage": 19944,
                    "mileage_category": "1-2万公里",
                    "dealer_name": "广州日产",
                    "occurrence_region": "华南",
                    "fault_category": "过温故障",
                    "service_method": "更换总成",
                    "defect_description": "车辆报故障码无法解析申请更换总成并跟进分析",
                    "purchase_date": "2024-01-01",
                    "is_return_required": True,
                    "requires_physical_analysis": True,
                },
            ]
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["total"] == 2
    assert data["items"][0]["received_date"] == "2026-05-01"
    assert data["items"][0]["product_model"] == "AV010A"
    assert data["items"][0]["failure_count"] == 2
    assert data["items"][1]["return_type"] == "零星退件"
    assert data["items"][1]["return_month"] == "2026-05"
    assert data["items"][1]["service_months"] == 13
    assert data["items"][1]["service_month_category"] == "12-24月"
    assert data["items"][1]["mileage_category"] == "1-2万公里"
    assert data["items"][1]["dealer_name"] == "广州日产"


@pytest.mark.asyncio
async def test_create_customer_complaint_accepts_customer_name_snapshot(async_client: AsyncClient, test_user_token: str):
    response = await async_client.post(
        "/api/v1/customer-complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_type": "0km",
            "customer_name": "附件导入客户",
            "occurrence_date": "2026-05-03",
            "product_type": "MCU",
            "product_model": "MCU-0KM-A",
            "defect_description": "客户现场基础信息表仅提供客户名称仍需支持登记",
            "is_return_required": False,
            "requires_physical_analysis": False,
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["customer_code"] == "附件导入客户"
    assert data["customer_name"] == "附件导入客户"
    assert data["product_model"] == "MCU-0KM-A"


@pytest.mark.asyncio
async def test_list_internal_user_options(async_client: AsyncClient, test_user_token: str):
    response = await async_client.get(
        "/api/v1/customer-complaints/internal-users",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert {"id", "username", "full_name"}.issubset(data[0].keys())


@pytest.mark.asyncio
async def test_record_physical_analysis_success(async_client: AsyncClient, test_user_token: str):
    create_response = await async_client.post(
        "/api/v1/customer-complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_type": "0km",
            "customer_code": "CUST010",
            "product_type": "Module",
            "defect_description": "\u5ba2\u6237\u9000\u4ef6\u9700\u8981\u5b9e\u7269\u89e3\u6790\u540e\u518d\u8ddf\u8fdb",
            "requires_physical_analysis": True,
        },
    )
    assert create_response.status_code == 201
    complaint_id = create_response.json()["id"]

    user_options_response = await async_client.get(
        "/api/v1/customer-complaints/internal-users",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    responsible_user_id = user_options_response.json()[0]["id"]

    analysis_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/physical-analysis",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "responsible_dept": "FAE",
            "responsible_user_id": responsible_user_id,
            "analysis_status": "completed",
            "failed_part_number": "PN-FA-900",
            "analysis_summary": "\u5df2\u786e\u8ba4\u5931\u6548\u4ef6\u4e0e\u4e00\u6b21\u56e0",
            "analysis_notes": "\u5efa\u8bae\u8fdb\u5165\u540e\u7eed\u53d1\u5355",
        },
    )

    assert analysis_response.status_code == 200
    data = analysis_response.json()
    assert data["physical_analysis_status"] == "completed"
    assert data["status"] == "in_response"
    assert data["failed_part_number"] == "PN-FA-900"


@pytest.mark.asyncio
async def test_init_eight_d_report_success(async_client: AsyncClient, test_user_token: str):
    create_response = await async_client.post(
        "/api/v1/customer-complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_type": "0km",
            "customer_code": "CUST020",
            "product_type": "MODULE-A",
            "defect_description": "\u5b9e\u7269\u89e3\u6790\u5b8c\u6210\u540e\u53ef\u4ee5\u53d1\u8d778D",
            "requires_physical_analysis": True,
        },
    )
    assert create_response.status_code == 201
    complaint_id = create_response.json()["id"]

    user_options_response = await async_client.get(
        "/api/v1/customer-complaints/internal-users",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    responsible_user_id = user_options_response.json()[0]["id"]

    analysis_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/physical-analysis",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "responsible_dept": "FAE",
            "responsible_user_id": responsible_user_id,
            "analysis_status": "completed",
            "analysis_summary": "\u5df2\u5b8c\u6210\u4e00\u6b21\u56e0\u5206\u6790\u5e76\u786e\u8ba4\u6839\u56e0",
        },
    )
    assert analysis_response.status_code == 200

    init_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/8d/init",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )

    assert init_response.status_code == 200
    data = init_response.json()
    assert data["complaint_id"] == complaint_id
    assert data["status"] == "d4_d7_in_progress"

    detail_response = await async_client.get(
        f"/api/v1/customer-complaints/{complaint_id}",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert detail_response.status_code == 200
    detail_data = detail_response.json()
    assert detail_data["eight_d_report_id"] == data["id"]
    assert detail_data["eight_d_status"] == "d4_d7_in_progress"


@pytest.mark.asyncio
async def test_init_eight_d_report_requires_completed_analysis(async_client: AsyncClient, test_user_token: str):
    create_response = await async_client.post(
        "/api/v1/customer-complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_type": "0km",
            "customer_code": "CUST021",
            "product_type": "MODULE-B",
            "defect_description": "\u5b9e\u7269\u89e3\u6790\u672a\u5b8c\u6210\u4e0d\u80fd\u53d1\u8d778D",
            "requires_physical_analysis": True,
        },
    )
    assert create_response.status_code == 201
    complaint_id = create_response.json()["id"]

    init_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/8d/init",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )

    assert init_response.status_code == 400
    assert "8D" in init_response.json()["detail"]


@pytest.mark.asyncio
async def test_init_eight_d_report_after_disposition_plan(async_client: AsyncClient, test_user_token: str):
    create_response = await async_client.post(
        "/api/v1/customer-complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_type": "0km",
            "customer_code": "CUST022",
            "product_type": "MODULE-C",
            "defect_description": "\u65e0\u9700\u5b9e\u7269\u89e3\u6790\u4f46\u9700\u8981\u53d1\u8d778D",
            "requires_physical_analysis": False,
        },
    )
    assert create_response.status_code == 201
    complaint_id = create_response.json()["id"]

    disposition_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/physical-disposition",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "disposition_plan": "\u5df2\u786e\u8ba4\u5b9e\u7269\u5904\u7406\u65b9\u6848\u5e76\u9700\u8981\u540e\u7eed8D\u8ddf\u8fdb",
            "disposition_status": "in_progress",
        },
    )
    assert disposition_response.status_code == 200

    init_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/8d/init",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )

    assert init_response.status_code == 200
    assert init_response.json()["status"] == "d4_d7_in_progress"


@pytest.mark.asyncio
async def test_list_customer_eight_d_reports(async_client: AsyncClient, test_user_token: str):
    create_response = await async_client.post(
        "/api/v1/customer-complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_type": "after_sales",
            "customer_code": "CUST8D01",
            "product_type": "ECU-BOX",
            "defect_description": "\u552e\u540e\u5ba2\u8bc9\u5df2\u7ecf\u5b8c\u6210\u5904\u7406\u65b9\u6848\u5907\u6848\u5e76\u51c6\u5907\u53d1\u8d778D",
            "requires_physical_analysis": False,
            "vin_code": "LVS12345678901234",
            "mileage": 12000,
            "purchase_date": "2025-11-01",
        },
    )
    assert create_response.status_code == 201
    complaint_id = create_response.json()["id"]

    disposition_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/physical-disposition",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "disposition_plan": "\u5df2\u5b8c\u6210\u5ba2\u8bc9\u5904\u7406\u65b9\u6848\u5907\u6848\u5e76\u7b49\u5f85\u540e\u7eed8D\u95ed\u73af",
            "disposition_status": "in_progress",
        },
    )
    assert disposition_response.status_code == 200

    init_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/8d/init",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert init_response.status_code == 200
    report_number = init_response.json()["report_number"]
    assert report_number.startswith("ZX8D-CQ1-")

    list_response = await async_client.get(
        "/api/v1/customer-complaints/8d/reports",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["total"] >= 1

    target = next(item for item in payload["items"] if item["complaint_id"] == complaint_id)
    assert target["report_number"] == report_number
    assert target["response_mode"] == "eight_d"
    assert target["problem_number"].startswith("ZXQ-CQ1-")
    assert target["eight_d_number"] == report_number
    assert target["primary_complaint_number"] == create_response.json()["complaint_number"]
    assert target["complaint_type"] == "after_sales"
    assert target["status"] == "d4_d7_in_progress"

    filter_response = await async_client.get(
        "/api/v1/customer-complaints/8d/reports",
        headers={"Authorization": f"Bearer {test_user_token}"},
        params={"report_number": report_number},
    )
    assert filter_response.status_code == 200
    filtered_payload = filter_response.json()
    assert filtered_payload["total"] == 1
    assert filtered_payload["items"][0]["report_number"] == report_number


@pytest.mark.asyncio
async def test_customer_follow_up_reports_include_brief_problem_reports(
    async_client: AsyncClient,
    test_user_token: str,
):
    create_response = await async_client.post(
        "/api/v1/customer-complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_type": "after_sales",
            "customer_code": "CUST-FOLLOW-BRIEF",
            "customer_name": "Brief Follow Customer",
            "product_type": "VCU",
            "defect_description": "After-sales complaint should create a ZXQ brief follow-up list row",
            "is_return_required": False,
            "requires_physical_analysis": False,
            "vin_code": "LVSFOLLOWBRIEF001",
            "mileage": 1200,
        },
    )
    assert create_response.status_code == 201
    complaint = create_response.json()

    report_response = await async_client.post(
        "/api/v1/problem-management/reports",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "module_key": "customer_quality",
            "problem_category_key": "CQ1",
            "title": "Brief complaint follow-up",
            "description": "Brief complaint follow-up should be visible together with customer 8D reports",
            "risk_level": "medium",
            "response_mode": "brief",
            "sources": [
                {
                    "source_type": "customer_complaint",
                    "source_id": complaint["id"],
                    "source_number": complaint["complaint_number"],
                    "is_primary": True,
                }
            ],
        },
    )
    assert report_response.status_code == 201
    problem_report = report_response.json()
    assert problem_report["problem_number"].startswith("ZXQ-CQ1-")
    assert problem_report["eight_d_number"] is None

    list_response = await async_client.get(
        "/api/v1/customer-complaints/8d/reports",
        headers={"Authorization": f"Bearer {test_user_token}"},
        params={"report_number": problem_report["problem_number"]},
    )

    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["total"] == 1
    item = payload["items"][0]
    assert item["report_number"] == problem_report["problem_number"]
    assert item["problem_number"] == problem_report["problem_number"]
    assert item["eight_d_number"] is None
    assert item["response_mode"] == "brief"
    assert item["problem_report_id"] == problem_report["id"]
    assert item["complaint_id"] == complaint["id"]
    assert item["primary_complaint_number"] == complaint["complaint_number"]
    assert item["complaint_type"] == "after_sales"
    assert item["status"] == "open"


@pytest.mark.asyncio
async def test_record_physical_disposition_rejects_analysis_required_case(async_client: AsyncClient, test_user_token: str):
    create_response = await async_client.post(
        "/api/v1/customer-complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_type": "0km",
            "customer_code": "CUST023",
            "product_type": "Electronic",
            "defect_description": "\u5ba2\u6237\u9000\u4ef6\u9700\u8981\u5148\u505a\u5b9e\u7269\u89e3\u6790\u624d\u80fd\u5904\u7406",
            "requires_physical_analysis": True,
        },
    )
    assert create_response.status_code == 201
    complaint_id = create_response.json()["id"]

    disposition_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_id}/physical-disposition",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "disposition_plan": "\u5c1d\u8bd5\u76f4\u63a5\u5907\u6848\u5904\u7406",
            "disposition_status": "in_progress",
        },
    )

    assert disposition_response.status_code == 400


@pytest.mark.asyncio
async def test_init_aggregate_eight_d_report_success(async_client: AsyncClient, test_user_token: str):
    complaint_ids = []
    for customer_code, product_type, defect_description in [
        ("CUST030", "MODULE-X", "同一客户两条客诉需要合并到一张 8D 中处理"),
        ("CUST030", "MODULE-Y", "同一客户第二条客诉也需要合并发起 8D"),
    ]:
        create_response = await async_client.post(
            "/api/v1/customer-complaints",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "complaint_type": "0km",
                "customer_code": customer_code,
                "product_type": product_type,
                "defect_description": defect_description,
                "requires_physical_analysis": False,
            },
        )
        assert create_response.status_code == 201
        complaint_id = create_response.json()["id"]
        complaint_ids.append(complaint_id)

        disposition_response = await async_client.post(
            f"/api/v1/customer-complaints/{complaint_id}/physical-disposition",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "disposition_plan": "已完成客诉实物处理方案备案并准备合并发起 8D",
                "disposition_status": "in_progress",
            },
        )
        assert disposition_response.status_code == 200

    init_response = await async_client.post(
        "/api/v1/customer-complaints/8d/init",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_ids": complaint_ids,
            "primary_complaint_id": complaint_ids[0],
        },
    )

    assert init_response.status_code == 200
    data = init_response.json()
    assert data["complaint_id"] == complaint_ids[0]
    assert data["status"] == "d4_d7_in_progress"
    assert len(data["related_complaints"]) == 2
    assert data["related_complaints"][0]["complaint_id"] == complaint_ids[0]
    assert data["related_complaints"][0]["is_primary"] is True
    assert data["related_complaints"][1]["complaint_id"] == complaint_ids[1]

    secondary_detail_response = await async_client.get(
        f"/api/v1/customer-complaints/{complaint_ids[1]}",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert secondary_detail_response.status_code == 200
    secondary_detail = secondary_detail_response.json()
    assert secondary_detail["eight_d_report_id"] == data["id"]
    assert secondary_detail["eight_d_status"] == "d4_d7_in_progress"

    secondary_report_response = await async_client.get(
        f"/api/v1/customer-complaints/{complaint_ids[1]}/8d",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert secondary_report_response.status_code == 200
    assert secondary_report_response.json()["id"] == data["id"]


@pytest.mark.asyncio
async def test_init_aggregate_eight_d_report_requires_same_customer(async_client: AsyncClient, test_user_token: str):
    complaint_ids = []
    for customer_code in ["CUST031", "CUST032"]:
        create_response = await async_client.post(
            "/api/v1/customer-complaints",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "complaint_type": "0km",
                "customer_code": customer_code,
                "product_type": "MODULE-Z",
                "defect_description": "不同客户的客诉不能直接聚合发起 8D，需要先分别处理",
                "requires_physical_analysis": False,
            },
        )
        assert create_response.status_code == 201
        complaint_id = create_response.json()["id"]
        complaint_ids.append(complaint_id)

        disposition_response = await async_client.post(
            f"/api/v1/customer-complaints/{complaint_id}/physical-disposition",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "disposition_plan": "已完成处理方案备案",
                "disposition_status": "in_progress",
            },
        )
        assert disposition_response.status_code == 200

    init_response = await async_client.post(
        "/api/v1/customer-complaints/8d/init",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_ids": complaint_ids,
            "primary_complaint_id": complaint_ids[0],
        },
    )

    assert init_response.status_code == 400
    assert "同一客户" in init_response.json()["detail"]


@pytest.mark.asyncio
async def test_append_related_complaints_to_existing_eight_d(async_client: AsyncClient, test_user_token: str):
    complaint_ids = []
    for product_type in ["MODULE-S1", "MODULE-S2", "MODULE-S3"]:
        create_response = await async_client.post(
            "/api/v1/customer-complaints",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "complaint_type": "0km",
                "customer_code": "CUST033",
                "product_type": product_type,
                "defect_description": "同一客户客诉准备追加到已发起的 8D 范围中",
                "requires_physical_analysis": False,
            },
        )
        assert create_response.status_code == 201
        complaint_id = create_response.json()["id"]
        complaint_ids.append(complaint_id)

        disposition_response = await async_client.post(
            f"/api/v1/customer-complaints/{complaint_id}/physical-disposition",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "disposition_plan": "已完成客诉处理方案备案，满足追加到 8D 的前置条件",
                "disposition_status": "in_progress",
            },
        )
        assert disposition_response.status_code == 200

    init_response = await async_client.post(
        "/api/v1/customer-complaints/8d/init",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_ids": complaint_ids[:2],
            "primary_complaint_id": complaint_ids[0],
        },
    )
    assert init_response.status_code == 200

    append_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_ids[0]}/8d/complaints",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={"complaint_ids": [complaint_ids[2]]},
    )

    assert append_response.status_code == 200
    data = append_response.json()
    assert len(data["related_complaints"]) == 3
    assert {item["complaint_id"] for item in data["related_complaints"]} == set(complaint_ids)
    assert data["d0_d3_cqe"]["related_complaint_count"] == 3

    detail_response = await async_client.get(
        f"/api/v1/customer-complaints/{complaint_ids[2]}",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert detail_response.status_code == 200
    detail_data = detail_response.json()
    assert detail_data["eight_d_report_id"] == data["id"]


@pytest.mark.asyncio
async def test_remove_related_complaint_from_existing_eight_d(async_client: AsyncClient, test_user_token: str):
    complaint_ids = []
    for product_type in ["MODULE-R1", "MODULE-R2"]:
        create_response = await async_client.post(
            "/api/v1/customer-complaints",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "complaint_type": "after_sales",
                "customer_code": "CUST034",
                "product_type": product_type,
                "defect_description": "同一客户客诉准备从 8D 关联范围中移除次级客诉",
                "requires_physical_analysis": False,
                "vin_code": "LSVAA4182E2123456",
                "mileage": 26000,
                "purchase_date": "2023-06-15",
            },
        )
        assert create_response.status_code == 201
        complaint_id = create_response.json()["id"]
        complaint_ids.append(complaint_id)

        disposition_response = await async_client.post(
            f"/api/v1/customer-complaints/{complaint_id}/physical-disposition",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "disposition_plan": "已完成客诉处理方案备案，满足发起和调整 8D 的前置条件",
                "disposition_status": "in_progress",
            },
        )
        assert disposition_response.status_code == 200

    init_response = await async_client.post(
        "/api/v1/customer-complaints/8d/init",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_ids": complaint_ids,
            "primary_complaint_id": complaint_ids[0],
        },
    )
    assert init_response.status_code == 200
    report_id = init_response.json()["id"]

    remove_response = await async_client.delete(
        f"/api/v1/customer-complaints/{complaint_ids[0]}/8d/complaints/{complaint_ids[1]}",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )

    assert remove_response.status_code == 200
    data = remove_response.json()
    assert len(data["related_complaints"]) == 1
    assert data["related_complaints"][0]["complaint_id"] == complaint_ids[0]
    assert data["d0_d3_cqe"]["related_complaint_count"] == 1

    removed_detail_response = await async_client.get(
        f"/api/v1/customer-complaints/{complaint_ids[1]}",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert removed_detail_response.status_code == 200
    removed_detail = removed_detail_response.json()
    assert removed_detail["eight_d_report_id"] is None

    report_response = await async_client.get(
        f"/api/v1/customer-complaints/{complaint_ids[0]}/8d",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert report_response.status_code == 200
    assert report_response.json()["id"] == report_id


@pytest.mark.asyncio
async def test_switch_primary_complaint_within_existing_eight_d(async_client: AsyncClient, test_user_token: str):
    complaint_ids = []
    for product_type in ["MODULE-P1", "MODULE-P2"]:
        create_response = await async_client.post(
            "/api/v1/customer-complaints",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "complaint_type": "0km",
                "customer_code": "CUST035",
                "product_type": product_type,
                "defect_description": "同一客户客诉需要在聚合 8D 中切换主客诉锚点",
                "requires_physical_analysis": False,
            },
        )
        assert create_response.status_code == 201
        complaint_id = create_response.json()["id"]
        complaint_ids.append(complaint_id)

        disposition_response = await async_client.post(
            f"/api/v1/customer-complaints/{complaint_id}/physical-disposition",
            headers={"Authorization": f"Bearer {test_user_token}"},
            json={
                "disposition_plan": "已完成客诉处理方案备案，满足聚合 8D 调整主客诉的前置条件",
                "disposition_status": "in_progress",
            },
        )
        assert disposition_response.status_code == 200

    init_response = await async_client.post(
        "/api/v1/customer-complaints/8d/init",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={
            "complaint_ids": complaint_ids,
            "primary_complaint_id": complaint_ids[0],
        },
    )
    assert init_response.status_code == 200

    switch_response = await async_client.post(
        f"/api/v1/customer-complaints/{complaint_ids[0]}/8d/primary-complaint",
        headers={"Authorization": f"Bearer {test_user_token}"},
        json={"primary_complaint_id": complaint_ids[1]},
    )

    assert switch_response.status_code == 200
    data = switch_response.json()
    assert data["complaint_id"] == complaint_ids[1]
    assert data["related_complaints"][0]["complaint_id"] == complaint_ids[1]
    assert data["related_complaints"][0]["is_primary"] is True
    assert data["d0_d3_cqe"]["source_complaint_number"] == data["related_complaints"][0]["complaint_number"]
    assert data["d0_d3_cqe"]["related_complaint_count"] == 2

    report_response = await async_client.get(
        f"/api/v1/customer-complaints/{complaint_ids[1]}/8d",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert report_response.status_code == 200
    report_data = report_response.json()
    assert report_data["complaint_id"] == complaint_ids[1]

    first_detail_response = await async_client.get(
        f"/api/v1/customer-complaints/{complaint_ids[0]}",
        headers={"Authorization": f"Bearer {test_user_token}"},
    )
    assert first_detail_response.status_code == 200
    first_detail_data = first_detail_response.json()
    assert first_detail_data["eight_d_report_id"] == data["id"]
