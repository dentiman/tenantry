// Control-plane контракти: імпортувати як '@saas-skeleton/contracts/platform'.
// НЕ реекспортується з головного index пакета — plane-и мають незалежні конвеєри.
export * from './platform.schema';
export * from './platform.types';
