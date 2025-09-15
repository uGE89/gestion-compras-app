import { query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/**
 * Valida los datos de una transferencia y construye el objeto listo para guardar.
 * @param {object} data - Datos de transferencia a validar y formatear.
 * @param {object} options - Opciones adicionales.
 * @param {import('firebase/firestore').CollectionReference} options.transfersCollection - Colección de Firestore donde se verifican duplicados.
 * @param {Array} options.accountMappingsArray - Arreglo de cuentas bancarias para mapear el ID seleccionado.
 * @param {string} [options.editingTransferId] - ID de la transferencia que se está editando, si aplica.
 * @returns {Promise<object>} - Objeto validado y listo para guardar.
 * @throws {Error} - Si la validación falla.
 */
export async function validateAndBuildTransfer(data, options = {}) {
  console.debug('validateAndBuildTransfer received', { data, options });
  const {
    fecha,
    tipo,
    numero_confirmacion,
    observaciones,
    bankAccountId,
    cantidad,
    moneda,
    imageUrl,
    createdByUsername,
    alegraContactId,
    alegraCategoryId,
    linkedPairId,
    pairGroupId,
    isMirror,
    mirrorOfId,
  } = data;

  const { transfersCollection, accountMappingsArray = [], editingTransferId } = options;
  const transferId = data?.id || editingTransferId;
  const warn = (message, context = {}) => {
    if (transferId) {
      context.id = transferId;
    }
    console.warn(message, context);
  };

  if (!fecha) {
    warn('Missing field: fecha');
    throw new Error('La Fecha es obligatoria.');
  }
  if (!bankAccountId) {
    warn('Missing field: bankAccountId');
    throw new Error('Debes seleccionar una Cuenta bancaria.');
  }
  if (!cantidad || cantidad <= 0) {
    warn('Invalid field: cantidad', { cantidad });
    throw new Error('Monto inválido. Sube el comprobante de nuevo.');
  }
  if (editingTransferId && !numero_confirmacion) {
    warn('Missing field: numero_confirmacion');
    throw new Error('El N° de confirmación es obligatorio para aprobar.');
  }

  const allowDupBecauseLinked = Boolean(data.linkedPairId || data.pairGroupId);

  if (numero_confirmacion && transfersCollection && !allowDupBecauseLinked) {
    const q = query(transfersCollection, where('numero_confirmacion', '==', numero_confirmacion));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty && querySnapshot.docs[0].id !== editingTransferId) {
      warn('Duplicate numero_confirmacion', { numero_confirmacion });
      throw new Error(`El N° de confirmación ${numero_confirmacion} ya existe.`);
    }
  }

  const selectedAccount = accountMappingsArray.find(acc => acc.id === bankAccountId);
  if (!selectedAccount) {
    warn('Invalid bankAccountId', { bankAccountId });
    throw new Error('Cuenta bancaria inválida.');
  }

  const result = {
    fecha,
    tipo,
    numero_confirmacion,
    observaciones,
    banco: selectedAccount.name,
    bankAccountId: selectedAccount.id,
    color: selectedAccount.color,
    cantidad,
    moneda: moneda || '',
    imageUrl,
    createdByUsername: createdByUsername || 'Anónimo',
    linkedPairId: linkedPairId || null,
    pairGroupId: pairGroupId || null,
    isMirror: Boolean(isMirror),
    mirrorOfId: mirrorOfId || null,
  };

  if (alegraContactId) {
    result.alegraContactId = alegraContactId;
  }
  if (alegraCategoryId) {
    result.alegraCategoryId = alegraCategoryId;
  }

  return result;
}