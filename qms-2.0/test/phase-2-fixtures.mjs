const baseUrl = process.env.QMS_PHASE2_BASE_URL;
if (!baseUrl) throw new Error('QMS_PHASE2_BASE_URL is required for real browser acceptance');
export const phase2Fixture = { baseUrl, username: process.env.QMS_PHASE2_USERNAME, password: process.env.QMS_PHASE2_PASSWORD };
