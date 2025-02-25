import { ChainId } from '@stacks/network';
import { createUnsecuredToken, TokenSigner } from 'jsontokens';
import { getKeys, getUserSession, hasAppPrivateKey } from '../transactions';
import { StacksProvider } from '../types';
import {
  CommonSignatureRequestOptions,
  SignatureOptions,
  SignaturePayload,
  SignaturePopup,
  SignatureRequestOptions,
} from '../types/signature';
import { getStacksProvider, legacyNetworkFromConnectNetwork } from '../utils';

function getStxAddress(options: CommonSignatureRequestOptions) {
  const { userSession, network: _network } = options;

  if (!userSession || !_network) return undefined;
  const stxAddresses = userSession?.loadUserData().profile?.stxAddress;
  const chainIdToKey = {
    [ChainId.Mainnet]: 'mainnet',
    [ChainId.Testnet]: 'testnet',
  };
  const network = legacyNetworkFromConnectNetwork(_network);
  const address: string | undefined = stxAddresses?.[chainIdToKey[network.chainId]];
  return address;
}

// eslint-disable-next-line @typescript-eslint/require-await
async function signPayload(payload: SignaturePayload, privateKey: string) {
  const tokenSigner = new TokenSigner('ES256k', privateKey);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return tokenSigner.signAsync({ ...payload } as any);
}

export function getDefaultSignatureRequestOptions(options: CommonSignatureRequestOptions) {
  const network = legacyNetworkFromConnectNetwork(options.network);
  const userSession = getUserSession(options.userSession);
  const defaults: CommonSignatureRequestOptions = {
    ...options,
    network,
    userSession,
  };
  return {
    stxAddress: getStxAddress(defaults),
    ...defaults,
  };
}

async function openSignaturePopup({ token, options }: SignaturePopup, provider: StacksProvider) {
  try {
    const signatureResponse = await provider.signatureRequest(token);
    options.onFinish?.(signatureResponse);
  } catch (error) {
    console.error('[Connect] Error during signature request', error);
    options.onCancel?.();
  }
}

export interface SignatureRequestPayload {
  message: string;
}

// eslint-disable-next-line @typescript-eslint/require-await
export const signMessage = async (options: SignatureRequestOptions) => {
  const { userSession, ..._options } = options;
  if (hasAppPrivateKey(userSession)) {
    const { privateKey, publicKey } = getKeys(userSession);

    const payload: SignaturePayload = {
      ..._options,
      publicKey,
    };

    return signPayload(payload, privateKey);
  }
  const payload = { ..._options };
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return createUnsecuredToken(payload as any);
};

async function generateTokenAndOpenPopup<T extends SignatureOptions>(
  options: T,
  makeTokenFn: (options: T) => Promise<string>,
  provider: StacksProvider
) {
  const token = await makeTokenFn({
    ...getDefaultSignatureRequestOptions(options),
    ...options,
  } as T);
  return openSignaturePopup({ token, options }, provider);
}

export function openSignatureRequestPopup(
  options: SignatureRequestOptions,
  provider: StacksProvider = getStacksProvider()
) {
  if (!provider) throw new Error('[Connect] No installed Stacks wallet found');
  return generateTokenAndOpenPopup(options, signMessage, provider);
}
