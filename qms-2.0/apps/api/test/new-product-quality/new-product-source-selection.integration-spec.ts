import { NewProductQualityService } from '../../src/modules/new-product-quality/new-product-quality.service.js';

describe('new product source selection contract', () => {
  it('requires the source selection and issue lifecycle methods', () => {
    expect(typeof NewProductQualityService.prototype.selectProcessDefect).toBe('function');
    expect(typeof NewProductQualityService.prototype.issueSelectedDefects).toBe('function');
    expect(typeof NewProductQualityService.prototype.escalateIssue).toBe('function');
    expect(typeof NewProductQualityService.prototype.createLegacyIssue).toBe('function');
    expect(typeof NewProductQualityService.prototype.approveMassProduction).toBe('function');
  });
});
