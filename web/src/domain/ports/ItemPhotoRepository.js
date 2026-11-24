import { enforceContract, abstractMethod } from '../support/contracts';

/**
 * PORT — the photos attached to punch items (SCRUM-88).
 *
 * The bytes are in the MediaStore; this keeps which item each photo shows,
 * who added it and when.
 */
export class ItemPhotoRepository {
  static REQUIRED = ['listFor', 'listForProject', 'add', 'remove'];

  constructor() {
    enforceContract(this, new.target, ItemPhotoRepository);
  }

  /**
   * @param {string} annotationId
   * @returns {Promise<import('../itemphotos/ItemPhoto').ItemPhoto[]>} Oldest first.
   */
  async listFor(annotationId) {
    return abstractMethod('ItemPhotoRepository', 'listFor', annotationId);
  }

  /**
   * Every item's photos in one read — for the issued PDF.
   * @param {number} projectId
   * @returns {Promise<Map<string, import('../itemphotos/ItemPhoto').ItemPhoto[]>>} By item id.
   */
  async listForProject(projectId) {
    return abstractMethod('ItemPhotoRepository', 'listForProject', projectId);
  }

  /**
   * @param {{ annotation: import('../annotations/Annotation').Annotation, media: import('../media/MediaRef').MediaRef, caption?: string }} photo
   * @returns {Promise<import('../itemphotos/ItemPhoto').ItemPhoto>}
   */
  async add(photo) {
    return abstractMethod('ItemPhotoRepository', 'add', photo);
  }

  /**
   * @param {import('../itemphotos/ItemPhoto').ItemPhoto} photo
   * @returns {Promise<void>}
   */
  async remove(photo) {
    return abstractMethod('ItemPhotoRepository', 'remove', photo);
  }
}
