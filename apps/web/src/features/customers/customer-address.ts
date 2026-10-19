interface AddressFields {
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

/**
 * Адреса одним рядком («208 Elm Street, 94569 Leeds, GB»). Одне правило складання
 * і для картки кастомера, і для колонки гріда — інакше вони розійдуться порядком частин.
 * Порожні частини (API віддає і `''`, і `null`) пропускаються.
 */
export function formatCustomerAddress(customer: AddressFields): string {
  return [
    customer.addressLine1,
    customer.addressLine2,
    [customer.postalCode, customer.city].filter(Boolean).join(' '),
    customer.region,
    customer.country,
  ]
    .filter((part) => part && part.length > 0)
    .join(', ');
}
