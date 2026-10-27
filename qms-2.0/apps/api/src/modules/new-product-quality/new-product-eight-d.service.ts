import { Injectable } from '@nestjs/common';
import { INTERNAL_EIGHT_D_DOMAINS } from '../../common/eight-d/internal-eight-d-domain.js';
import { InternalEightDHttpService } from '../../common/eight-d/internal-eight-d-http.js';
import { ProcessEightDService } from '../process-quality/process-eight-d.service.js';

@Injectable()
export class NewProductEightDService extends InternalEightDHttpService {
  constructor(core: ProcessEightDService) {
    if (core.domain !== INTERNAL_EIGHT_D_DOMAINS.NEW_PRODUCT) throw new Error('INTERNAL_EIGHT_D_DOMAIN_INVALID');
    super(core);
  }
}
