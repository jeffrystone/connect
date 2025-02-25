import { AppConfig, UserSession } from '@stacks/auth';
import { bytesToHex, hexToBytes } from '@stacks/common';
import { ChainId } from '@stacks/network';
import {
  deserializeTransaction,
  PostCondition,
  postConditionToHex,
  serializeCV,
} from '@stacks/transactions';
import {
  PostCondition as LegacyPostCondition,
  serializeCV as legacySerializeCV,
  serializePostCondition as legacySerializePostCondition,
} from '@stacks/transactions-v6';
import { createUnsecuredToken, Json, SECP256K1Client, TokenSigner } from 'jsontokens';
import { StacksProvider } from '../types';
import {
  ContractCallOptions,
  ContractCallPayload,
  ContractCallRegularOptions,
  ContractCallSponsoredOptions,
  ContractDeployOptions,
  ContractDeployPayload,
  ContractDeployRegularOptions,
  ContractDeploySponsoredOptions,
  FinishedTxPayload,
  SignTransactionOptions,
  SignTransactionPayload,
  SponsoredFinishedTxPayload,
  STXTransferOptions,
  STXTransferPayload,
  STXTransferRegularOptions,
  STXTransferSponsoredOptions,
  TransactionOptions,
  TransactionPayload,
  TransactionPopup,
  TransactionTypes,
} from '../types/transactions';
import { getStacksProvider, legacyNetworkFromConnectNetwork } from '../utils';

// TODO extract out of transactions
export const getUserSession = (_userSession?: UserSession) => {
  let userSession = _userSession;

  if (!userSession) {
    const appConfig = new AppConfig(['store_write'], document.location.href);
    userSession = new UserSession({ appConfig });
  }
  return userSession;
};

export function hasAppPrivateKey(userSession?: UserSession) {
  try {
    const session = getUserSession(userSession).loadUserData();
    return session.appPrivateKey;
  } catch (e) {
    return false;
  }
}

export const getKeys = (_userSession?: UserSession) => {
  const userSession = getUserSession(_userSession);
  const privateKey = userSession.loadUserData().appPrivateKey;
  const publicKey = SECP256K1Client.derivePublicKey(privateKey);

  return { privateKey, publicKey };
};

// TODO extract out of transactions
export function getStxAddress(options: TransactionOptions) {
  const { stxAddress, userSession, network: _network } = options;

  if (stxAddress) return stxAddress;
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

function getDefaults(options: TransactionOptions) {
  const network = legacyNetworkFromConnectNetwork(options.network);

  const userSession = getUserSession(options.userSession);
  const defaults: TransactionOptions = {
    ...options,
    network,
    userSession,
  };

  return {
    stxAddress: getStxAddress(defaults),
    ...defaults,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await
async function signPayload(payload: TransactionPayload, privateKey: string) {
  let { postConditions } = payload;
  if (postConditions && postConditions.length > 0 && typeof postConditions[0] !== 'string') {
    if (typeof postConditions[0].type === 'string') {
      // new readable types
      postConditions = (postConditions as PostCondition[]).map(postConditionToHex);
    } else {
      // legacy types
      postConditions = (postConditions as LegacyPostCondition[]).map(pc => {
        return bytesToHex(legacySerializePostCondition(pc));
      });
    }
  }
  const tokenSigner = new TokenSigner('ES256k', privateKey);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return tokenSigner.signAsync({ ...payload, postConditions } as any);
}

function createUnsignedTransactionPayload(payload: Partial<TransactionPayload>) {
  let { postConditions } = payload;
  if (postConditions && postConditions.length > 0 && typeof postConditions[0] !== 'string') {
    if (typeof postConditions[0].type === 'string') {
      // new readable types
      postConditions = (postConditions as PostCondition[]).map(postConditionToHex);
    } else {
      // legacy types
      postConditions = (postConditions as LegacyPostCondition[]).map(pc => {
        return bytesToHex(legacySerializePostCondition(pc));
      });
    }
  }
  return createUnsecuredToken({ ...payload, postConditions } as unknown as Json);
}

const openTransactionPopup = async (
  { token, options }: TransactionPopup,
  provider: StacksProvider
) => {
  try {
    const txResponse = await provider.transactionRequest(token);
    const { txRaw } = txResponse;
    const txBytes = hexToBytes(txRaw.replace(/^0x/, ''));
    const stacksTransaction = deserializeTransaction(txBytes);

    if ('sponsored' in options && options.sponsored) {
      options.onFinish?.({
        ...(txResponse as SponsoredFinishedTxPayload),
        stacksTransaction,
      });
      return;
    }
    options.onFinish?.({
      ...(txResponse as FinishedTxPayload),
      stacksTransaction,
    });
  } catch (error) {
    console.error('[Connect] Error during transaction request', error);
    options.onCancel?.();
  }
};

// eslint-disable-next-line @typescript-eslint/require-await
export const makeContractCallToken = async (options: ContractCallOptions) => {
  const { functionArgs, appDetails, userSession, ..._options } = options;

  const args: string[] = functionArgs.map(arg => {
    if (typeof arg === 'string') {
      return arg;
    }
    if (typeof arg.type === 'string') {
      // new readable types
      return serializeCV(arg);
    }

    // legacy types
    return bytesToHex(legacySerializeCV(arg));
  });
  if (hasAppPrivateKey(userSession)) {
    const { privateKey, publicKey } = getKeys(userSession);
    const payload: ContractCallPayload = {
      ..._options,
      functionArgs: args,
      txType: TransactionTypes.ContractCall,
      publicKey,
    };
    if (appDetails) payload.appDetails = appDetails;
    return signPayload(payload, privateKey);
  }
  const payload: Partial<ContractCallPayload> = {
    ..._options,
    functionArgs: args,
    txType: TransactionTypes.ContractCall,
  };
  if (appDetails) payload.appDetails = appDetails;
  return createUnsignedTransactionPayload(payload);
};

// eslint-disable-next-line @typescript-eslint/require-await
export const makeContractDeployToken = async (options: ContractDeployOptions) => {
  const { appDetails, userSession, ..._options } = options;
  if (hasAppPrivateKey(userSession)) {
    const { privateKey, publicKey } = getKeys(userSession);
    const payload: ContractDeployPayload = {
      ..._options,
      publicKey,
      txType: TransactionTypes.ContractDeploy,
    };
    if (appDetails) payload.appDetails = appDetails;
    return signPayload(payload, privateKey);
  }

  const payload: Partial<ContractDeployPayload> = {
    ..._options,
    txType: TransactionTypes.ContractDeploy,
  };
  if (appDetails) payload.appDetails = appDetails;
  return createUnsignedTransactionPayload(payload);
};

// eslint-disable-next-line @typescript-eslint/require-await
export const makeSTXTransferToken = async (options: STXTransferOptions) => {
  const { amount, appDetails, userSession, ..._options } = options;

  if (hasAppPrivateKey(userSession)) {
    const { privateKey, publicKey } = getKeys(userSession);
    const payload: STXTransferPayload = {
      ..._options,
      amount: amount.toString(10),
      publicKey,
      txType: TransactionTypes.STXTransfer,
    };
    if (appDetails) payload.appDetails = appDetails;
    return signPayload(payload, privateKey);
  }

  const payload: Partial<STXTransferPayload> = {
    ..._options,
    amount: amount.toString(10),
    txType: TransactionTypes.STXTransfer,
  };
  if (appDetails) payload.appDetails = appDetails;
  return createUnsignedTransactionPayload(payload);
};

export const makeSignTransaction = async (options: SignTransactionOptions) => {
  const { txHex, appDetails, userSession, ..._options } = options;

  if (hasAppPrivateKey(userSession)) {
    const { privateKey, publicKey } = getKeys(userSession);
    const payload: SignTransactionPayload = {
      ..._options,
      txHex,
      publicKey,
    };
    if (appDetails) payload.appDetails = appDetails;
    return signPayload(payload, privateKey);
  }

  const payload: Partial<SignTransactionOptions> = {
    ..._options,
    txHex,
  };
  if (appDetails) payload.appDetails = appDetails;
  return createUnsignedTransactionPayload(payload);
};

async function generateTokenAndOpenPopup<T extends TransactionOptions>(
  options: T,
  makeTokenFn: (options: T) => Promise<string>,
  provider: StacksProvider
) {
  const token = await makeTokenFn({
    ...getDefaults(options),
    ...options,
    network: legacyNetworkFromConnectNetwork(options.network), // ensure network is legacy compatible
  } as T);
  return openTransactionPopup({ token, options }, provider);
}

export function openContractCall(
  options: ContractCallOptions | ContractCallRegularOptions | ContractCallSponsoredOptions,
  provider: StacksProvider = getStacksProvider()
) {
  if (!provider) throw new Error('[Connect] No installed Stacks wallet found');
  return generateTokenAndOpenPopup(options, makeContractCallToken, provider);
}

export function openContractDeploy(
  options: ContractDeployOptions | ContractDeployRegularOptions | ContractDeploySponsoredOptions,
  provider: StacksProvider = getStacksProvider()
) {
  if (!provider) throw new Error('[Connect] No installed Stacks wallet found');
  return generateTokenAndOpenPopup(options, makeContractDeployToken, provider);
}

export function openSTXTransfer(
  options: STXTransferOptions | STXTransferRegularOptions | STXTransferSponsoredOptions,
  provider: StacksProvider = getStacksProvider()
) {
  if (!provider) throw new Error('[Connect] No installed Stacks wallet found');
  return generateTokenAndOpenPopup(options, makeSTXTransferToken, provider);
}

export function openSignTransaction(
  options: SignTransactionOptions,
  provider: StacksProvider = getStacksProvider()
) {
  if (!provider) throw new Error('[Connect] No installed Stacks wallet found');
  return generateTokenAndOpenPopup(options, makeSignTransaction, provider);
}
