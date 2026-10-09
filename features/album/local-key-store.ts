import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { ed25519 } from '@noble/curves/ed25519.js';

import { fromBase64, toBase64 } from '@/features/album/crypto';
import {
  generateDeviceKeys,
  toWire,
  type DeviceIdentity,
  type DeviceKeys,
  type SigningKeypair,
  type WireDeviceIdentity,
  identityOf,
} from '@/features/album/keys';

/**
 * Where the keys actually live.
 *
 * The split is the point. Private keys go in the platform keystore, which is
 * hardware-backed on Android and protected by the Secure Enclave's class
 * keys on iOS, and which we ask to be device-only so they never ride along
 * in a backup. Public keys and the device's own bookkeeping are ordinary
 * app data, because there is nothing secret about them and they need to be
 * readable to render a screen.
 *
 * `requireAuthentication` is deliberately *not* set here. It would mean the
 * OS refuses to hand the key over without a Face ID or fingerprint check,
 * which is a good property and eventually the right one, but it prompts on
 * every read. A gallery that asks you to authenticate to look at a photo is
 * worse than the thing it protects. It belongs behind a session unlock —
 * authenticate once, hold the derived key in memory, re-prompt on
 * backgrounding — and that is a piece of UI, not a storage flag.
 */

const KEY_PREFIX = 'aoi.album.keys.v1.';

function devicePrefix(spaceId: string): string {
  return `${KEY_PREFIX}${spaceId}.`;
}

/**
 * SecureStore values are strings, so a keypair is stored base64. These are
 * deliberately chunked: a 32-byte key is comfortably inside the platform
 * limits, and splitting it would only add a way to reassemble it wrongly.
 *
 * On web there is no SecureStore, so the private halves fall back to
 * AsyncStorage. That is not a keystore and must never ship as the production
 * path; it exists because the browser is a development preview and the
 * alternative is a preview with no album at all. Native always uses the
 * platform keystore.
 */
async function writeSecret(name: string, key: Uint8Array): Promise<void> {
  const value = toBase64(key);
  if (Platform.OS === 'web') {
    // dev/web only — AsyncStorage is not hardware-backed.
    await AsyncStorage.setItem(name, value);
    return;
  }
  await SecureStore.setItemAsync(name, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function readSecret(name: string): Promise<Uint8Array | null> {
  const stored =
    Platform.OS === 'web'
      ? await AsyncStorage.getItem(name)
      : await SecureStore.getItemAsync(name);
  return stored ? fromBase64(stored) : null;
}

async function deleteSecret(name: string): Promise<void> {
  if (Platform.OS === 'web') {
    // dev/web only — mirror the AsyncStorage fallback above.
    await AsyncStorage.removeItem(name);
    return;
  }
  await SecureStore.deleteItemAsync(name);
}

export type StoredDevice = {
  identity: DeviceIdentity;
  createdAt: string;
};

export type LocalKeyStore = {
  /** Create and persist this device's keys, or return the ones already here. */
  ensureDevice: (spaceId: string, deviceId: string) => Promise<DeviceKeys>;
  /** Rehydrate the private halves after a restart. Null when it is a new device. */
  loadDevice: (spaceId: string) => Promise<DeviceKeys | null>;
  forgetDevice: (spaceId: string) => Promise<void>;
};

export function createLocalKeyStore(): LocalKeyStore {
  return {
    async ensureDevice(spaceId, deviceId) {
      const existing = await this.loadDevice(spaceId);
      if (existing) {
        return existing;
      }
      const createdAt = new Date();
      const device = generateDeviceKeys(deviceId, createdAt);
      const base = devicePrefix(spaceId);

      await writeSecret(`${base}signing.private`, device.signing.privateKey);
      await writeSecret(`${base}agreement.private`, device.agreement.privateKey);
      await AsyncStorage.setItem(
        `${base}device`,
        JSON.stringify(toWire(identityOf(device))),
      );
      return device;
    },

    async loadDevice(spaceId) {
      const base = devicePrefix(spaceId);
      const raw = await AsyncStorage.getItem(`${base}device`);
      if (!raw) {
        return null;
      }
      const [signingPrivate, agreementPrivate] = await Promise.all([
        readSecret(`${base}signing.private`),
        readSecret(`${base}agreement.private`),
      ]);
      if (!signingPrivate || !agreementPrivate) {
        // Public half without the secret half is a device we cannot decrypt
        // with, so it is treated as no device rather than half of one.
        return null;
      }
      let identity: DeviceIdentity;
      try {
        const wire = JSON.parse(raw) as WireDeviceIdentity;
        identity = {
          deviceId: wire.deviceId,
          createdAt: wire.createdAt,
          signingPublicKey: fromBase64(wire.signingPublicKey),
          agreementPublicKey: fromBase64(wire.agreementPublicKey),
        };
      } catch {
        return null;
      }
      const signing: SigningKeypair = {
        privateKey: signingPrivate,
        publicKey: ed25519.getPublicKey(signingPrivate),
      };
      return {
        deviceId: identity.deviceId,
        createdAt: new Date(identity.createdAt),
        signing,
        agreement: { privateKey: agreementPrivate, publicKey: identity.agreementPublicKey },
      };
    },

    async forgetDevice(spaceId) {
      const base = devicePrefix(spaceId);
      await Promise.all([
        deleteSecret(`${base}signing.private`),
        deleteSecret(`${base}agreement.private`),
      ]);
      await AsyncStorage.removeItem(`${base}device`);
    },
  };
}
