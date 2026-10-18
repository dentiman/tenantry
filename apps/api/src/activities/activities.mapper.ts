// Мапінг спільний для обох плейнів (стрічка тенанта в control plane — той самий формат),
// тому живе поруч із recorder-ом у libs/shared; тут — публічна точка модуля для сусідів
export { toActivityResponse } from '@saas-skeleton/shared';
