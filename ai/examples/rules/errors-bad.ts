/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

// empty

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

// empty

export class InvoiceLookup {
  /**
   * @section private:attributes
   */

  // empty

  /**
   * @section protected:attributes
   */

  // empty

  /**
   * @section private:properties
   */

  // empty

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  // empty

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(): InvoiceLookup {
    const lookup = new InvoiceLookup();
    return lookup;
  }

  /**
   * @section private:methods
   */

  // empty

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public ensureInvoiceExists(invoiceId: string, exists: boolean): void {
    try {
      if (!exists) {
        throw "missing";
      }
    } catch {
      // bad: error is silently swallowed
    }

    if (!exists) {
      throw new Error("failed");
    }

    console.log(invoiceId);
  }

  /**
   * @section static:methods
   */

  // empty
}
