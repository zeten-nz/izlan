import { ConfigService } from '@nestjs/config';
import { OtpCodeService } from './otp-code.service';

function makeService(pepper = 'test-pepper-abcdef0123456789'): OtpCodeService {
  const config = { getOrThrow: () => ({ otpPepper: pepper }) } as unknown as ConfigService;
  return new OtpCodeService(config);
}

describe('OtpCodeService', () => {
  const svc = makeService();

  it('generates exactly 6 decimal digits', () => {
    for (let i = 0; i < 200; i++) {
      const code = svc.generateCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('preserves leading zeros (6-char string)', () => {
    let sawShortNumeric = false;
    for (let i = 0; i < 500; i++) {
      const code = svc.generateCode();
      expect(code.length).toBe(6);
      if (Number(code) < 100000) sawShortNumeric = true;
    }
    expect(sawShortNumeric).toBe(true); // leading-zero holatlar 6-char sifatida saqlanadi
  });

  it('same purpose+phone+code → same HMAC', () => {
    const a = svc.hashCode('LOGIN', '+998901234567', '004281');
    const b = svc.hashCode('LOGIN', '+998901234567', '004281');
    expect(a).toBe(b);
  });

  it('different phone/purpose → different digest', () => {
    const base = svc.hashCode('LOGIN', '+998901234567', '123456');
    expect(svc.hashCode('LOGIN', '+998901234568', '123456')).not.toBe(base);
    expect(svc.hashCode('PHONE_CHANGE', '+998901234567', '123456')).not.toBe(base);
    expect(svc.hashCode('LOGIN', '+998901234567', '123457')).not.toBe(base);
  });

  it('different pepper → different digest (server secret binds)', () => {
    const a = makeService('pepper-one').hashCode('LOGIN', '+998901234567', '123456');
    const b = makeService('pepper-two').hashCode('LOGIN', '+998901234567', '123456');
    expect(a).not.toBe(b);
  });

  it('verify true for correct code, false for wrong', () => {
    const hash = svc.hashCode('LOGIN', '+998901234567', '123456');
    expect(svc.verifyCode('LOGIN', '+998901234567', '123456', hash)).toBe(true);
    expect(svc.verifyCode('LOGIN', '+998901234567', '000000', hash)).toBe(false);
  });

  it('raw code never equals stored hash', () => {
    const code = '123456';
    const hash = svc.hashCode('LOGIN', '+998901234567', code);
    expect(hash).not.toContain(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  it('verify false on malformed stored hash', () => {
    expect(svc.verifyCode('LOGIN', '+998901234567', '123456', 'not-hex')).toBe(false);
    expect(svc.verifyCode('LOGIN', '+998901234567', '123456', '')).toBe(false);
  });
});
