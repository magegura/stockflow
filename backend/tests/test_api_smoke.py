import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT_DIR))

TEST_DB = Path(__file__).resolve().parent / 'test_stockflow.db'
os.environ['DATABASE_PATH'] = str(TEST_DB)
os.environ['JWT_SECRET'] = 'test-secret'

if TEST_DB.exists():
    TEST_DB.unlink()

from app.main import app  # noqa: E402


def login(client: TestClient, email: str, password: str) -> str:
    response = client.post('/api/auth/login', json={'email': email, 'password': password})
    assert response.status_code == 200
    return response.json()['access_token']


def test_health() -> None:
    with TestClient(app) as client:
        response = client.get('/api/health')
        assert response.status_code == 200
        assert response.json()['status'] == 'ok'


def test_dashboard_seed_data() -> None:
    with TestClient(app) as client:
        token = login(client, 'admin@stockflow.app', 'Admin123!')
        response = client.get('/api/dashboard', headers={'Authorization': f'Bearer {token}'})
        assert response.status_code == 200

        data = response.json()
        assert data['total_products'] >= 6
        assert data['total_sales_count'] >= 6
        assert len(data['top_products']) >= 1
        assert len(data['revenue_by_day']) >= 1


def test_create_edit_and_delete_product() -> None:
    with TestClient(app) as client:
        token = login(client, 'admin@stockflow.app', 'Admin123!')
        headers = {'Authorization': f'Bearer {token}'}

        create_response = client.post(
            '/api/products',
            headers=headers,
            json={
                'name': 'Portable SSD',
                'sku': 'SSD-777',
                'price': 99.0,
                'stock': 5,
                'min_stock': 2,
            },
        )
        assert create_response.status_code == 200
        product_id = create_response.json()['product_id']

        update_response = client.put(
            f'/api/products/{product_id}',
            headers=headers,
            json={
                'name': 'Portable SSD 1TB',
                'sku': 'SSD-777',
                'price': 109.0,
                'min_stock': 3,
            },
        )
        assert update_response.status_code == 200

        products_response = client.get('/api/products', headers=headers)
        assert products_response.status_code == 200
        products = products_response.json()['items']
        assert any(product['name'] == 'Portable SSD 1TB' for product in products)

        delete_response = client.delete(f'/api/products/{product_id}', headers=headers)
        assert delete_response.status_code == 200


def test_cannot_delete_seed_product_with_sales_history() -> None:
    with TestClient(app) as client:
        token = login(client, 'admin@stockflow.app', 'Admin123!')
        headers = {'Authorization': f'Bearer {token}'}

        response = client.delete('/api/products/1', headers=headers)
        assert response.status_code == 400
        assert 'sales history' in response.json()['detail'].lower()


def test_sale_rejects_duplicate_products() -> None:
    with TestClient(app) as client:
        token = login(client, 'employee@stockflow.app', 'Employee123!')
        headers = {'Authorization': f'Bearer {token}'}

        response = client.post(
            '/api/sales',
            headers=headers,
            json={
                'items': [
                    {'product_id': 1, 'quantity': 1},
                    {'product_id': 1, 'quantity': 1},
                ]
            },
        )
        assert response.status_code == 400
        assert 'duplicate' in response.json()['detail'].lower()
