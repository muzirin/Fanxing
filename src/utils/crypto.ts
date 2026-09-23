/**
 * 登录参数加密：AES-128-CBC + PKCS7 -> Base64。
 * 纯 Node crypto，无 vscode 依赖。
 */
import { createCipheriv } from 'crypto';
import { AES_KEY } from '../config/constants';

/** 学习通登录参数加密 */
export function encryptLoginField(plain: string, secret: string = AES_KEY): string {
  const key = Buffer.from(secret, 'utf8').subarray(0, 16);
  const iv = key;
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}
