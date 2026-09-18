import { Injectable } from '@nestjs/common';
import { PasswordHasherService } from '../../common/security/password-hasher.service.js';

@Injectable()
export class PasswordService {
  private readonly dummyHash: Promise<string>;

  constructor(private readonly hasher: PasswordHasherService) {
    this.dummyHash = hasher.hash('qms-invalid-account-timing-padding');
  }

  hash(password: string): Promise<string> {
    return this.hasher.hash(password);
  }

  async verify(encodedHash: string, password: string): Promise<boolean> {
    try {
      return await this.hasher.verify(encodedHash, password);
    } catch {
      return false;
    }
  }

  async verifyUnknown(password: string): Promise<void> {
    await this.hasher.verify(await this.dummyHash, password);
  }
}
