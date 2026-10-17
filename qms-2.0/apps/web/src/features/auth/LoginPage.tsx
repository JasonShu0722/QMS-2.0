import type { LoginRequest } from '@qms/contracts';
import { Alert, Button, Checkbox, Form, Input, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../../i18n/Language';
import { ApiError, getSession, login, safeAccountError } from '../../api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  const [retryCount, setRetryCount] = useState(0);
  const [sessionState, setSessionState] = useState<'checking' | 'unauthenticated' | 'error'>('checking');

  useEffect(() => {
    let active = true;
    setSessionState('checking');
    getSession().then((session) => {
      if (active) navigate(session.landingPath, { replace: true });
    }).catch((cause: unknown) => {
      if (!active) return;
      setSessionState(cause instanceof ApiError && (cause.status === 401 || ['HTTP_401', 'AUTH_SESSION_REQUIRED'].includes(cause.code))
        ? 'unauthenticated' : 'error');
    });
    return () => { active = false; };
  }, [navigate, retryCount]);

  async function submit(values: LoginRequest) {
    if (sessionState !== 'unauthenticated') return;
    setLoading(true);
    setError(null);
    try {
      const result = await login({ ...values, rememberMe: values.rememberMe ?? false });
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

  const invalidFields = error?.code === 'VALIDATION_FAILED' ? ['identifier', 'password'].filter((field) => error.fields[field]?.length) : [];

  return (
    <main className="login-container">
      <header className="login-topbar">
        <div className="brand-block">
          <span className="brand-mark">QMS</span>
          <span className="brand-caption">Quality Management System</span>
        </div>
        <div className="entry-note" aria-hidden="true">
          <span className="entry-note__line" />
          <span>{t('质量管理平台')}</span>
        </div>
      </header>

      <section className="login-stage">
        <div className="hero-panel">
          <div className="hero-copy">
            <p className="hero-kicker">Quality Management System</p>
            <h1>{t('让质量更透明')}<br />{t('让协同更高效')}</h1>
          </div>
        </div>

        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-panel-shell">
            <div className="login-panel-head">
              <p>QMS Access</p>
              <Typography.Title id="login-title" level={1}>{t('账号登录')}</Typography.Title>
            </div>
            {sessionState === 'checking' ? <div role="status" aria-label={t('正在验证登录状态')}><Spin size="small" /> {t('正在验证登录状态')}</div> : null}
            {sessionState === 'error' ? <Alert
              showIcon type="error" role="alert" title={t('暂时无法验证登录状态')}
              description={t('请检查网络连接后重试。')}
              action={<Button onClick={() => setRetryCount((count) => count + 1)}>{t('重试')}</Button>}
            /> : null}
            {error ? (
              <Alert
                showIcon
                type="error"
                title={t(safeAccountError(error))} role="alert"
                description={
                  <div>
                    {invalidFields.map((field) => (
                      <div key={field}>{t(field === 'identifier' ? '账号' : '密码')}: {t('请检查填写内容')}</div>
                    ))}
                    {error.traceId ? <code>{error.traceId}</code> : null}
                  </div>
                }
              />
            ) : null}
            <Form layout="vertical" onFinish={submit} initialValues={{ rememberMe: false }} className="login-form">
              <Form.Item label={t('账号')} name="identifier" rules={[{ required: true, message: t('请输入账号') }]}>
                <Input autoComplete="username" size="large" />
              </Form.Item>
              <Form.Item label={t('密码')} name="password" rules={[{ required: true, message: t('请输入密码') }]}>
                <Input.Password autoComplete="current-password" size="large" />
              </Form.Item>
              <Form.Item name="rememberMe" valuePropName="checked" extra={t('管理员保持登录 7 天，普通账号 30 天。请勿在公共设备上勾选。')}>
                <Checkbox>{t('记住登录')}</Checkbox>
              </Form.Item>
              <Button disabled={sessionState !== 'unauthenticated'} aria-label={t('登录')} block type="primary" htmlType="submit" loading={loading} size="large">
                {t('登录')}
              </Button>
            </Form>
            <Link to="/password-recovery">{t('找回密码')}</Link>
          </div>
        </section>
      </section>
    </main>
  );
}
