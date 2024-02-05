import { Agent, HttpOutboundTransport, MediatorPickupStrategy, WsOutboundTransport } from '@aries-framework/core'
import { IndyVdrPoolConfig, IndyVdrPoolService } from '@aries-framework/indy-vdr/build/pool'
import { useAgent } from '@aries-framework/react-hooks'
import { agentDependencies } from '@aries-framework/react-native'
import {
  LocalStorageKeys,
  DispatchAction,
  Screens,
  Stacks,
  OnboardingState,
  LoginAttemptState,
  PreferencesState,
  MigrationState,
  ToursState,
  useAuth,
  useTheme,
  useStore,
  useConfiguration,
  InfoBox,
  InfoBoxType,
  testIdWithKey,
  didMigrateToAskar,
  migrateToAskar,
  getAgentModules,
  createLinkSecretIfRequired,
} from '@hyperledger/aries-bifold-core'
import { RemoteLogger, RemoteLoggerOptions } from '@hyperledger/aries-bifold-remote-logs'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { CommonActions, useNavigation } from '@react-navigation/native'
import moment from 'moment'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View, Text, Image, useWindowDimensions, ScrollView } from 'react-native'
import { Config } from 'react-native-config'
import {
  getVersion,
  getBuildNumber,
  getApplicationName,
  getSystemName,
  getSystemVersion,
} from 'react-native-device-info'
import { SafeAreaView } from 'react-native-safe-area-context'

import ProgressBar from '../components/ProgressBar'
import TipCarousel from '../components/TipCarousel'
import { autoDisableRemoteLoggingIntervalInMinutes } from '../constants'
import { useAttestation } from '../services/attestation'
import { BCState, BCDispatchAction, BCLocalStorageKeys } from '../store'

enum InitErrorTypes {
  Onboarding,
  Agent,
}

const onboardingComplete = (state: OnboardingState): boolean => {
  return state.didCompleteTutorial && state.didAgreeToTerms && state.didCreatePIN && state.didConsiderBiometry
}

const resumeOnboardingAt = (
  state: OnboardingState,
  enableWalletNaming: boolean | undefined,
  showPreface: boolean | undefined
): Screens => {
  if (
    (state.didSeePreface || !showPreface) &&
    state.didCompleteTutorial &&
    state.didAgreeToTerms &&
    state.didCreatePIN &&
    (state.didNameWallet || !enableWalletNaming) &&
    !state.didConsiderBiometry
  ) {
    return Screens.UseBiometry
  }

  if (
    (state.didSeePreface || !showPreface) &&
    state.didCompleteTutorial &&
    state.didAgreeToTerms &&
    state.didCreatePIN &&
    enableWalletNaming &&
    !state.didNameWallet
  ) {
    return Screens.NameWallet
  }

  if (
    (state.didSeePreface || !showPreface) &&
    state.didCompleteTutorial &&
    state.didAgreeToTerms &&
    !state.didCreatePIN
  ) {
    return Screens.CreatePIN
  }

  if ((state.didSeePreface || !showPreface) && state.didCompleteTutorial && !state.didAgreeToTerms) {
    return Screens.Terms
  }

  if (state.didSeePreface || !showPreface) {
    return Screens.Onboarding
  }

  return Screens.Preface
}

/*
  To customize this splash screen set the background color of the
  iOS and Android launch screen to match the background color of
  of this view.
*/
const Splash = () => {
  const { width } = useWindowDimensions()
  const { agent, setAgent } = useAgent()
  const { t } = useTranslation()
  const [store, dispatch] = useStore<BCState>()
  const navigation = useNavigation()
  const { getWalletCredentials } = useAuth()
  const { ColorPallet, Assets } = useTheme()
  const { indyLedgers, showPreface } = useConfiguration()
  const [stepText, setStepText] = useState<string>(t('Init.Starting'))
  const [progressPercent, setProgressPercent] = useState(0)
  const [initOnboardingCount, setInitOnboardingCount] = useState(0)
  const [initAgentCount, setInitAgentCount] = useState(0)
  const [initErrorType, setInitErrorType] = useState<InitErrorTypes>(InitErrorTypes.Onboarding)
  const [initError, setInitError] = useState<Error | null>(null)
  const steps: string[] = [
    t('Init.Starting'),
    t('Init.CheckingAuth'),
    t('Init.FetchingPreferences'),
    t('Init.VerifyingOnboarding'),
    t('Init.GettingCredentials'),
    t('Init.RegisteringTransports'),
    t('Init.InitializingAgent'),
    t('Init.ConnectingLedgers'),
    t('Init.SettingAgent'),
    t('Init.Finishing'),
  ]
  const { start, stop } = useAttestation()

  const setStep = (stepIdx: number) => {
    setStepText(steps[stepIdx])
    const percent = Math.floor(((stepIdx + 1) / steps.length) * 100)
    setProgressPercent(percent)
  }

  const styles = StyleSheet.create({
    screenContainer: {
      backgroundColor: ColorPallet.brand.primary,
      flex: 1,
    },
    scrollContentContainer: {
      flexGrow: 1,
      justifyContent: 'space-between',
    },
    progressContainer: {
      alignItems: 'center',
      width: '100%',
    },
    stepTextContainer: {
      marginTop: 10,
    },
    stepText: {
      fontFamily: 'BCSans-Regular',
      fontSize: 16,
      color: '#a8abae',
    },
    carouselContainer: {
      width,
      marginVertical: 30,
      flex: 1,
    },
    errorBoxContainer: {
      paddingHorizontal: 20,
    },
    logoContainer: {
      alignSelf: 'center',
      marginBottom: 30,
    },
  })

  useEffect(() => {
    if (!agent) {
      return
    }

    if (!store.developer.attestationSupportEnabled) {
      stop()
      return
    }

    start()
  }, [agent, store.developer.attestationSupportEnabled])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadObjectFromStorage = async (key: string): Promise<undefined | any> => {
    try {
      const data = await AsyncStorage.getItem(key)
      if (data) {
        return JSON.parse(data)
      }
    } catch {
      return
    }
  }

  const loadAuthAttempts = async (): Promise<LoginAttemptState | undefined> => {
    const attemptsData = await AsyncStorage.getItem(LocalStorageKeys.LoginAttempts)
    if (attemptsData) {
      const attempts = JSON.parse(attemptsData) as LoginAttemptState
      dispatch({
        type: DispatchAction.ATTEMPT_UPDATED,
        payload: [attempts],
      })
      return attempts
    }
  }

  const loadPersonNotificationDismissed = async (): Promise<void> => {
    const dismissed = await loadObjectFromStorage(BCLocalStorageKeys.PersonCredentialOfferDismissed)
    if (dismissed) {
      dispatch({
        type: BCDispatchAction.PERSON_CREDENTIAL_OFFER_DISMISSED,
        payload: [{ personCredentialOfferDismissed: dismissed.personCredentialOfferDismissed }],
      })
    }
  }

  const loadCachedLedgers = async (): Promise<IndyVdrPoolConfig[] | undefined> => {
    const cachedTransactions = await loadObjectFromStorage(BCLocalStorageKeys.GenesisTransactions)
    if (cachedTransactions) {
      const { timestamp, transactions } = cachedTransactions
      return moment().diff(moment(timestamp), 'days') >= 1 ? undefined : transactions
    }
  }

  const loadIASEnvironment = async (): Promise<void> => {
    const environment = await loadObjectFromStorage(BCLocalStorageKeys.Environment)
    if (environment) {
      dispatch({
        type: BCDispatchAction.UPDATE_ENVIRONMENT,
        payload: [environment],
      })
    }
  }

  const loadAttestationSupportOption = async (): Promise<void> => {
    const value = await loadObjectFromStorage(BCLocalStorageKeys.Attestation)
    if (value) {
      dispatch({
        type: BCDispatchAction.ATTESTATION_SUPPORT,
        payload: [value],
      })
    }
  }

  useEffect(() => {
    const initOnboarding = async (): Promise<void> => {
      try {
        setStep(0)
        if (store.authentication.didAuthenticate) {
          return
        }

        setStep(1)
        // load authentication attempts from storage
        const attemptData = await loadAuthAttempts()

        // load BCID person credential notification dismissed state from storage
        await loadPersonNotificationDismissed()

        await loadIASEnvironment()

        await loadAttestationSupportOption()

        setStep(2)
        const preferencesData = await AsyncStorage.getItem(LocalStorageKeys.Preferences)

        if (preferencesData) {
          const dataAsJSON = JSON.parse(preferencesData) as PreferencesState

          dispatch({
            type: DispatchAction.PREFERENCES_UPDATED,
            payload: [dataAsJSON],
          })
        }

        const migrationData = await AsyncStorage.getItem(LocalStorageKeys.Migration)
        if (migrationData) {
          const dataAsJSON = JSON.parse(migrationData) as MigrationState

          dispatch({
            type: DispatchAction.MIGRATION_UPDATED,
            payload: [dataAsJSON],
          })
        }

        const toursData = await AsyncStorage.getItem(LocalStorageKeys.Tours)
        if (toursData) {
          const dataAsJSON = JSON.parse(toursData) as ToursState

          dispatch({
            type: DispatchAction.TOUR_DATA_UPDATED,
            payload: [dataAsJSON],
          })
        }

        setStep(3)
        const data = await AsyncStorage.getItem(LocalStorageKeys.Onboarding)
        if (data) {
          const dataAsJSON = JSON.parse(data) as OnboardingState
          dispatch({
            type: DispatchAction.ONBOARDING_UPDATED,
            payload: [dataAsJSON],
          })

          if (onboardingComplete(dataAsJSON)) {
            // if they previously completed onboarding before wallet naming was enabled, mark complete
            if (!store.onboarding.didNameWallet) {
              dispatch({ type: DispatchAction.DID_NAME_WALLET, payload: [true] })
            }

            // if they previously completed onboarding before preface was enabled, mark seen
            if (!store.onboarding.didSeePreface) {
              dispatch({ type: DispatchAction.DID_SEE_PREFACE })
            }

            if (!attemptData?.lockoutDate) {
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: Screens.EnterPIN }],
                })
              )
            } else {
              // return to lockout screen if lockout date is set
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: Screens.AttemptLockout }],
                })
              )
            }

            return
          }

          // If onboarding was interrupted we need to pickup from where we left off.
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: resumeOnboardingAt(dataAsJSON, store.preferences.enableWalletNaming, showPreface) }],
            })
          )

          return
        }

        // We have no onboarding state, starting from step zero.
        if (showPreface) {
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: Screens.Preface }],
            })
          )
        } else {
          navigation.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: Screens.Onboarding }],
            })
          )
        }
      } catch (e: unknown) {
        setInitErrorType(InitErrorTypes.Onboarding)
        setInitError(e as Error)
      }
    }
    initOnboarding()
  }, [store.authentication.didAuthenticate, initOnboardingCount])

  useEffect(() => {
    const initAgent = async (): Promise<void> => {
      try {
        if (!store.authentication.didAuthenticate || !store.onboarding.didConsiderBiometry) {
          return
        }

        setStep(4)
        const credentials = await getWalletCredentials()

        if (!credentials?.id || !credentials.key) {
          // Cannot find wallet id/secret
          return
        }

        setStep(5)
        const cachedLedgers = await loadCachedLedgers()
        const ledgers = cachedLedgers ?? indyLedgers.concat({
          "indyNamespace": "bcovrin",
          "isProduction": true,
          "connectOnStartup": true,
          "genesisTransactions": "{\"reqSignature\":{},\"txn\":{\"data\":{\"data\":{\"alias\":\"Node1\",\"blskey\":\"4N8aUNHSgjQVgkpm8nhNEfDf6txHznoYREg9kirmJrkivgL4oSEimFF6nsQ6M41QvhM2Z33nves5vfSn9n1UwNFJBYtWVnHYMATn76vLuL3zU88KyeAYcHfsih3He6UHcXDxcaecHVz6jhCYz1P2UZn2bDVruL5wXpehgBfBaLKm3Ba\",\"blskey_pop\":\"RahHYiCvoNCtPTrVtP7nMC5eTYrsUA8WjXbdhNc8debh1agE9bGiJxWBXYNFbnJXoXhWFMvyqhqhRoq737YQemH5ik9oL7R4NTTCz2LEZhkgLJzB3QRQqJyBNyv7acbdHrAT8nQ9UkLbaVL9NBpnWXBTw4LEMePaSHEw66RzPNdAX1\",\"client_ip\":\"ledger.cloudapi.dev.didxtech.com\",\"client_port\":9702,\"node_ip\":\"ledger.cloudapi.dev.didxtech.com\",\"node_port\":9701,\"services\":[\"VALIDATOR\"]},\"dest\":\"Gw6pDLhcBcoQesN72qfotTgFa7cbuqZpkX3Xo6pLhPhv\"},\"metadata\":{\"from\":\"Th7MpTaRZVRYnPiabds81Y\"},\"type\":\"0\"},\"txnMetadata\":{\"seqNo\":1,\"txnId\":\"fea82e10e894419fe2bea7d96296a6d46f50f93f9eeda954ec461b2ed2950b62\"},\"ver\":\"1\"}\n{\"reqSignature\":{},\"txn\":{\"data\":{\"data\":{\"alias\":\"Node2\",\"blskey\":\"37rAPpXVoxzKhz7d9gkUe52XuXryuLXoM6P6LbWDB7LSbG62Lsb33sfG7zqS8TK1MXwuCHj1FKNzVpsnafmqLG1vXN88rt38mNFs9TENzm4QHdBzsvCuoBnPH7rpYYDo9DZNJePaDvRvqJKByCabubJz3XXKbEeshzpz4Ma5QYpJqjk\",\"blskey_pop\":\"Qr658mWZ2YC8JXGXwMDQTzuZCWF7NK9EwxphGmcBvCh6ybUuLxbG65nsX4JvD4SPNtkJ2w9ug1yLTj6fgmuDg41TgECXjLCij3RMsV8CwewBVgVN67wsA45DFWvqvLtu4rjNnE9JbdFTc1Z4WCPA3Xan44K1HoHAq9EVeaRYs8zoF5\",\"client_ip\":\"ledger.cloudapi.dev.didxtech.com\",\"client_port\":9704,\"node_ip\":\"ledger.cloudapi.dev.didxtech.com\",\"node_port\":9703,\"services\":[\"VALIDATOR\"]},\"dest\":\"8ECVSk179mjsjKRLWiQtssMLgp6EPhWXtaYyStWPSGAb\"},\"metadata\":{\"from\":\"EbP4aYNeTHL6q385GuVpRV\"},\"type\":\"0\"},\"txnMetadata\":{\"seqNo\":2,\"txnId\":\"1ac8aece2a18ced660fef8694b61aac3af08ba875ce3026a160acbc3a3af35fc\"},\"ver\":\"1\"}\n{\"reqSignature\":{},\"txn\":{\"data\":{\"data\":{\"alias\":\"Node3\",\"blskey\":\"3WFpdbg7C5cnLYZwFZevJqhubkFALBfCBBok15GdrKMUhUjGsk3jV6QKj6MZgEubF7oqCafxNdkm7eswgA4sdKTRc82tLGzZBd6vNqU8dupzup6uYUf32KTHTPQbuUM8Yk4QFXjEf2Usu2TJcNkdgpyeUSX42u5LqdDDpNSWUK5deC5\",\"blskey_pop\":\"QwDeb2CkNSx6r8QC8vGQK3GRv7Yndn84TGNijX8YXHPiagXajyfTjoR87rXUu4G4QLk2cF8NNyqWiYMus1623dELWwx57rLCFqGh7N4ZRbGDRP4fnVcaKg1BcUxQ866Ven4gw8y4N56S5HzxXNBZtLYmhGHvDtk6PFkFwCvxYrNYjh\",\"client_ip\":\"ledger.cloudapi.dev.didxtech.com\",\"client_port\":9706,\"node_ip\":\"ledger.cloudapi.dev.didxtech.com\",\"node_port\":9705,\"services\":[\"VALIDATOR\"]},\"dest\":\"DKVxG2fXXTU8yT5N7hGEbXB3dfdAnYv1JczDUHpmDxya\"},\"metadata\":{\"from\":\"4cU41vWW82ArfxJxHkzXPG\"},\"type\":\"0\"},\"txnMetadata\":{\"seqNo\":3,\"txnId\":\"7e9f355dffa78ed24668f0e0e369fd8c224076571c51e2ea8be5f26479edebe4\"},\"ver\":\"1\"}\n{\"reqSignature\":{},\"txn\":{\"data\":{\"data\":{\"alias\":\"Node4\",\"blskey\":\"2zN3bHM1m4rLz54MJHYSwvqzPchYp8jkHswveCLAEJVcX6Mm1wHQD1SkPYMzUDTZvWvhuE6VNAkK3KxVeEmsanSmvjVkReDeBEMxeDaayjcZjFGPydyey1qxBHmTvAnBKoPydvuTAqx5f7YNNRAdeLmUi99gERUU7TD8KfAa6MpQ9bw\",\"blskey_pop\":\"RPLagxaR5xdimFzwmz1XumxL1z6cDd4BbGZSPmdr4ZSh4RJT1JmcpUjx4cVWKteYQ4sHFQ2Ag7N5cEUsxYoQRoqC7o9cUHg7zC3q35m4Lb61Rk8PQV5BwFadA4GiGjR6PviuT9o8JDtJgbyhud1N2iJ8vSQZ8ipuYrC3d1E4U1YRoh\",\"client_ip\":\"ledger.cloudapi.dev.didxtech.com\",\"client_port\":9708,\"node_ip\":\"ledger.cloudapi.dev.didxtech.com\",\"node_port\":9707,\"services\":[\"VALIDATOR\"]},\"dest\":\"4UGuTTCBTUofWlwcVLFnQD4R5CJNYmyzJ4XZ3bRMU6Kw\"},\"metadata\":{\"from\":\"TWwCRQRZ2ZHMJFn9TzLp7W\"},\"type\":\"0\"},\"txnMetadata\":{\"seqNo\":4,\"txnId\":\"fe5be034f8a1cbf9a88aee417f0937e7a4a8e5d441e6aee6c12a28e4b0c10f22\"},\"ver\":\"1\"}"
        },

          {
            "indyNamespace": "bcovrin",
            "isProduction": true,
            "connectOnStartup": true,
            "genesisTransactions": "{\"reqSignature\":{},\"txn\":{\"data\":{\"data\":{\"alias\":\"Node1\",\"blskey\":\"4N8aUNHSgjQVgkpm8nhNEfDf6txHznoYREg9kirmJrkivgL4oSEimFF6nsQ6M41QvhM2Z33nves5vfSn9n1UwNFJBYtWVnHYMATn76vLuL3zU88KyeAYcHfsih3He6UHcXDxcaecHVz6jhCYz1P2UZn2bDVruL5wXpehgBfBaLKm3Ba\",\"blskey_pop\":\"RahHYiCvoNCtPTrVtP7nMC5eTYrsUA8WjXbdhNc8debh1agE9bGiJxWBXYNFbnJXoXhWFMvyqhqhRoq737YQemH5ik9oL7R4NTTCz2LEZhkgLJzB3QRQqJyBNyv7acbdHrAT8nQ9UkLbaVL9NBpnWXBTw4LEMePaSHEw66RzPNdAX1\",\"client_ip\":\"100.106.9.112\",\"client_port\":9702,\"node_ip\":\"100.106.9.112\",\"node_port\":9000,\"services\":[\"VALIDATOR\"]},\"dest\":\"Gw6pDLhcBcoQesN72qfotTgFa7cbuqZpkX3Xo6pLhPhv\"},\"metadata\":{\"from\":\"Th7MpTaRZVRYnPiabds81Y\"},\"type\":\"0\"},\"txnMetadata\":{\"seqNo\":1,\"txnId\":\"fea82e10e894419fe2bea7d96296a6d46f50f93f9eeda954ec461b2ed2950b62\"},\"ver\":\"1\"}\n{\"reqSignature\":{},\"txn\":{\"data\":{\"data\":{\"alias\":\"Node2\",\"blskey\":\"37rAPpXVoxzKhz7d9gkUe52XuXryuLXoM6P6LbWDB7LSbG62Lsb33sfG7zqS8TK1MXwuCHj1FKNzVpsnafmqLG1vXN88rt38mNFs9TENzm4QHdBzsvCuoBnPH7rpYYDo9DZNJePaDvRvqJKByCabubJz3XXKbEeshzpz4Ma5QYpJqjk\",\"blskey_pop\":\"Qr658mWZ2YC8JXGXwMDQTzuZCWF7NK9EwxphGmcBvCh6ybUuLxbG65nsX4JvD4SPNtkJ2w9ug1yLTj6fgmuDg41TgECXjLCij3RMsV8CwewBVgVN67wsA45DFWvqvLtu4rjNnE9JbdFTc1Z4WCPA3Xan44K1HoHAq9EVeaRYs8zoF5\",\"client_ip\":\"100.106.9.112\",\"client_port\":9704,\"node_ip\":\"100.106.9.112\",\"node_port\":9000,\"services\":[\"VALIDATOR\"]},\"dest\":\"8ECVSk179mjsjKRLWiQtssMLgp6EPhWXtaYyStWPSGAb\"},\"metadata\":{\"from\":\"EbP4aYNeTHL6q385GuVpRV\"},\"type\":\"0\"},\"txnMetadata\":{\"seqNo\":2,\"txnId\":\"1ac8aece2a18ced660fef8694b61aac3af08ba875ce3026a160acbc3a3af35fc\"},\"ver\":\"1\"}\n{\"reqSignature\":{},\"txn\":{\"data\":{\"data\":{\"alias\":\"Node3\",\"blskey\":\"3WFpdbg7C5cnLYZwFZevJqhubkFALBfCBBok15GdrKMUhUjGsk3jV6QKj6MZgEubF7oqCafxNdkm7eswgA4sdKTRc82tLGzZBd6vNqU8dupzup6uYUf32KTHTPQbuUM8Yk4QFXjEf2Usu2TJcNkdgpyeUSX42u5LqdDDpNSWUK5deC5\",\"blskey_pop\":\"QwDeb2CkNSx6r8QC8vGQK3GRv7Yndn84TGNijX8YXHPiagXajyfTjoR87rXUu4G4QLk2cF8NNyqWiYMus1623dELWwx57rLCFqGh7N4ZRbGDRP4fnVcaKg1BcUxQ866Ven4gw8y4N56S5HzxXNBZtLYmhGHvDtk6PFkFwCvxYrNYjh\",\"client_ip\":\"100.106.9.112\",\"client_port\":9706,\"node_ip\":\"100.106.9.112\",\"node_port\":9000,\"services\":[\"VALIDATOR\"]},\"dest\":\"DKVxG2fXXTU8yT5N7hGEbXB3dfdAnYv1JczDUHpmDxya\"},\"metadata\":{\"from\":\"4cU41vWW82ArfxJxHkzXPG\"},\"type\":\"0\"},\"txnMetadata\":{\"seqNo\":3,\"txnId\":\"7e9f355dffa78ed24668f0e0e369fd8c224076571c51e2ea8be5f26479edebe4\"},\"ver\":\"1\"}\n{\"reqSignature\":{},\"txn\":{\"data\":{\"data\":{\"alias\":\"Node4\",\"blskey\":\"2zN3bHM1m4rLz54MJHYSwvqzPchYp8jkHswveCLAEJVcX6Mm1wHQD1SkPYMzUDTZvWvhuE6VNAkK3KxVeEmsanSmvjVkReDeBEMxeDaayjcZjFGPydyey1qxBHmTvAnBKoPydvuTAqx5f7YNNRAdeLmUi99gERUU7TD8KfAa6MpQ9bw\",\"blskey_pop\":\"RPLagxaR5xdimFzwmzYnz4ZhWtYQEj8iR5ZU53T2gitPCyCHQneUn2HvX3QVQQ8hhT8MUr5fqHWTQAwZrU2SyVbKHaLxCHRgB57GK7qB7RFt3Xny8ZC2tAeHBxECQkTR1vJKMAKAosTiNF1JgMqEmBiJLyubKMJm4rD9ZohH1CZ9Zn\",\"client_ip\":\"100.106.9.112\",\"client_port\":9708,\"node_ip\":\"100.106.9.112\",\"node_port\":9000,\"services\":[\"VALIDATOR\"]},\"dest\":\"4PS6MZX6T7ELDSD2RUOZRSXSZR5BZL2VGAUWZZPPPYQXKEYFJKVJKVM2\"},\"metadata\":{\"from\":\"TWwCRQRZ2ZHMJFn9TzLp7W\"},\"type\":\"0\"},\"txnMetadata\":{\"seqNo\":4,\"txnId\":\"fe3c5a8deba62a4faeab9a4e362e7c7c9a932294abf97b2833cb81d75a0c7696\"},\"ver\":\"1\"}"
          })

        const logOptions: RemoteLoggerOptions = {
          lokiUrl: Config.REMOTE_LOGGING_URL,
          lokiLabels: {
            application: getApplicationName().toLowerCase(),
            job: 'react-native-logs',
            version: `${getVersion()}-${getBuildNumber()}`,
            system: `${getSystemName()} v${getSystemVersion()}`,
          },
          autoDisableRemoteLoggingIntervalInMinutes,
        }
        const logger = new RemoteLogger(logOptions)
        logger.startEventListeners()

        const options = {
          config: {
            label: store.preferences.walletName || 'DIDx Wallet',
            walletConfig: {
              id: credentials.id,
              key: credentials.key,
            },
            logger,
            mediatorPickupStrategy: MediatorPickupStrategy.Implicit,
            autoUpdateStorageOnStartup: true,
            autoAcceptConnections: true,
          },
          dependencies: agentDependencies,
          modules: getAgentModules({
            indyNetworks: ledgers,
            mediatorInvitationUrl: Config.MEDIATOR_URL,
          }),
        }

        const newAgent = new Agent(options)
        const wsTransport = new WsOutboundTransport()
        const httpTransport = new HttpOutboundTransport()

        newAgent.registerOutboundTransport(wsTransport)
        newAgent.registerOutboundTransport(httpTransport)

        // If we haven't migrated to Aries Askar yet, we need to do this before we initialize the agent.
        if (!didMigrateToAskar(store.migration)) {
          newAgent.config.logger.debug('Agent not updated to Aries Askar, updating...')

          await migrateToAskar(credentials.id, credentials.key, newAgent)

          newAgent.config.logger.debug('Successfully finished updating agent to Aries Askar')
          // Store that we migrated to askar.
          dispatch({
            type: DispatchAction.DID_MIGRATE_TO_ASKAR,
          })
        }

        setStep(6)
        await newAgent.initialize()
        const poolService = newAgent.dependencyManager.resolve(IndyVdrPoolService)
        if (!cachedLedgers) {
          // these escapes can be removed once Indy VDR has been upgraded and the patch is no longer needed
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore:next-line
          await poolService.refreshPoolConnections()
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore:next-line
          const raw_transactions = await poolService.getPoolTransactions()
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore:next-line
          const transactions = raw_transactions.map(({ config, transactions }) => ({
            ...config,
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore:next-line
            genesisTransactions: transactions.reduce((prev, curr) => {
              return prev + JSON.stringify(curr)
            }, ''),
          }))
          if (transactions) {
            await AsyncStorage.setItem(
              BCLocalStorageKeys.GenesisTransactions,
              JSON.stringify({ timestamp: moment().toISOString(), transactions })
            )
          }
        }

        setStep(7)
        await createLinkSecretIfRequired(newAgent)

        setStep(8)
        setAgent(newAgent)

        setStep(9)
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: Stacks.TabStack }],
          })
        )
      } catch (e: unknown) {
        setInitErrorType(InitErrorTypes.Agent)
        setInitError(e as Error)
      }
    }

    initAgent()
  }, [store.authentication.didAuthenticate, store.onboarding.didConsiderBiometry, initAgentCount])

  const handleErrorCallToActionPressed = () => {
    setInitError(null)
    if (initErrorType === InitErrorTypes.Agent) {
      setInitAgentCount(initAgentCount + 1)
    } else {
      setInitOnboardingCount(initOnboardingCount + 1)
    }
  }

  return (
    <SafeAreaView style={styles.screenContainer}>
      <ScrollView contentContainerStyle={styles.scrollContentContainer}>
        <View style={styles.progressContainer} testID={testIdWithKey('LoadingActivityIndicator')}>
          <ProgressBar progressPercent={progressPercent} />
          <View style={styles.stepTextContainer}>
            <Text style={styles.stepText}>{stepText}</Text>
          </View>
        </View>
        <View style={styles.carouselContainer}>
          {initError ? (
            <View style={styles.errorBoxContainer}>
              <InfoBox
                notificationType={InfoBoxType.Error}
                title={t('Error.Title2026')}
                description={t('Error.Message2026')}
                message={initError?.message || t('Error.Unknown')}
                onCallToActionLabel={t('Init.Retry')}
                onCallToActionPressed={handleErrorCallToActionPressed}
              />
            </View>
          ) : (
            <TipCarousel />
          )}
        </View>
        <View style={styles.logoContainer}>
          <Image
            source={Assets.img.logoPrimary.src}
            style={{ width: Assets.img.logoPrimary.width, height: Assets.img.logoPrimary.height }}
            testID={testIdWithKey('LoadingActivityIndicatorImage')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

export default Splash
