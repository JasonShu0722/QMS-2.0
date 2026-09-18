import { describe, expect, it } from 'vitest'

import { parseCustomerMasterImportContent } from '@/utils/customerMasterImport'

describe('parseCustomerMasterImportContent', () => {
  it('parses customer code and name pasted from a spreadsheet', () => {
    const items = parseCustomerMasterImportContent(
      [
        '1000000\t宁德时代新能源科技股份有限公司',
        '1000008\t郑州日产汽车有限公司',
        '1000018\t武汉电动汽车示范运营有限公司',
      ].join('\n'),
    )

    expect(items).toEqual([
      { code: '1000000', name: '宁德时代新能源科技股份有限公司' },
      { code: '1000008', name: '郑州日产汽车有限公司' },
      { code: '1000018', name: '武汉电动汽车示范运营有限公司' },
    ])
  })

  it('keeps the whole customer name when the pasted separator becomes spaces', () => {
    const items = parseCustomerMasterImportContent('1000061 东风时代（武汉）电池系统有限公司郑州分公司')

    expect(items).toEqual([
      { code: '1000061', name: '东风时代（武汉）电池系统有限公司郑州分公司' },
    ])
  })
})
