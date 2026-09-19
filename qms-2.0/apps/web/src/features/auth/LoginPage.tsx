import { Alert, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, login } from '../../api/client';

type LoginValues = {
  identifier: string;
  password: string;
};

export function LoginPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(values: LoginValues) {
    setLoading(true);
    setError(null);
    try {
      const result = await login(values);
      navigate(result.landingPath, { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError({ code: 'CLIENT_ERROR', message: '登录请求失败' }),
      );
    } finally {
      setLoading(false);
    }
  }

  const fieldMessages = Object.values(error?.fields ?? {}).flat();

  return (
    <main className="login-container">
      <header className="login-topbar">
        <div className="brand-block">
          <span className="brand-mark">QMS</span>
          <span className="brand-caption">Quality Management System</span>
        </div>
        <div className="entry-note" aria-hidden="true">
          <span className="entry-note__line" />
          <span>质量管理平台</span>
        </div>
      </header>

      <section className="login-stage">
        <div className="hero-panel">
          <div className="hero-copy">
            <p className="hero-kicker">Quality Management System</p>
            <h1>让质量更透明<br />让协同更高效</h1>
          </div>
        </div>

        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-panel-shell">
            <div className="login-panel-head">
              <p>QMS Access</p>
              <Typography.Title id="login-title" level={1}>账号登录</Typography.Title>
            </div>
            {error ? (
              <Alert
                showIcon
                type="error"
                title={error.message}
                description={
                  <div>
                    {fieldMessages.map((message) => (
                      <div key={message}>{message}</div>
                    ))}
                    {error.traceId ? <code>{error.traceId}</code> : null}
                  </div>
                }
              />
            ) : null}
            <Form layout="vertical" onFinish={submit} className="login-form">
              <Form.Item label="账号" name="identifier" rules={[{ required: true, message: '请输入账号' }]}>
                <Input autoComplete="username" size="large" />
              </Form.Item>
              <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password autoComplete="current-password" size="large" />
              </Form.Item>
              <Button aria-label="登录" block type="primary" htmlType="submit" loading={loading} size="large">
                登录
              </Button>
            </Form>
          </div>
        </section>
      </section>
    </main>
  );
}
