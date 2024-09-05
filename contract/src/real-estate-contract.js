// @ts-check

import { Far } from '@endo/far';
import { M } from '@endo/patterns';
import { AmountShape } from '@agoric/ertp/src/typeGuards.js';
import { AmountMath } from '@agoric/ertp';
import { atomicRearrange } from '@agoric/zoe/src/contractSupport/atomicTransfer.js';
import '@agoric/zoe/exported.js';

/**
 * In addition to the standard `issuers` and `brands` terms,
 * this contract is parameterized by terms for price and,
 * optionally, a maximum number of items sold for that price (default: 3).
 *
 * @typedef {{
 *   propertiesToCreate: bigint;
 *   tradePrice: Amount;
 * }} OfferUpTerms
 */

export const meta = {
  customTermsShape: M.splitRecord(
    { propertiesToCreate: M.bigint() },
    { tradePrice: M.arrayOf(AmountShape) },
  ),
};
// compatibility with an earlier contract metadata API
export const customTermsShape = meta.customTermsShape;

/**
 * Start a contract that
 *   - creates a new non-fungible asset type for Items, and
 *   - handles offers to buy up to `maxItems` items at a time.
 *
 * @param {ZCF<OfferUpTerms>} zcf
 */
export const start = async zcf => {
  const { propertiesToCreate } = zcf.getTerms();


  /**
   * Create mints according to the number of needed properties
   */
  const propertyMints = await Promise.all(
    [...Array(Number(propertiesToCreate))].map((_, index) =>
      zcf.makeZCFMint(`PlayProperty_${index}`),
    ),
  );

  const proposalShape = harden({
    exit: M.any(),
    give: { GiveAsset: M.any() },
    want: { WantAsset: M.any() },
  });

  // Creat a map of available properties indexed by their brand
  const availableProperties = {};

  const tradeHandler = buyerSeat => {
    const { give, want } = buyerSeat.getProposal();
    // if brand associated with the give is not IST then push/insert the buyerSeat to the availableProperties

    console.log(
      'give---------------------------------------------',
      give.GiveAsset.brand.getAllegedName(),
    );
    if (give.GiveAsset.brand.getAllegedName() === 'Property') {
      availableProperties[give.GiveAsset.brand.getAllegedName()] = buyerSeat;
      return 'Property has been made available for sale. Looking for buyers...';
    }

    // search brand of want in the availableProperties - if not found then exit the buyerSeat and return
    if (!availableProperties[want.WantAsset.brand.getAllegedName()]) return buyerSeat.exit();

    // if found then then see if the buyerSeat matches the corresponding availableProperties property
    const sellerSeat =
      availableProperties[want.WantAsset.brand.getAllegedName()];

    // if sellerSeat.give is not equal to or greater than the buyerSeat.want then exit the buyerSeat and vice versa
    if (
      !AmountMath.isGTE(
        sellerSeat.getProposal().give.GiveAsset,
        want.WantAsset,
      ) ||
      !AmountMath.isGTE(give.GiveAsset, sellerSeat.getProposal().want.WantAsset)
    ) return buyerSeat.exit();

    // All conditions meet - let us execute the trade
    atomicRearrange(
      zcf,
      harden([
        [buyerSeat, sellerSeat, give, sellerSeat.getProposal().want],
        [sellerSeat, buyerSeat, sellerSeat.getProposal().give, want],
      ]),
    );

    buyerSeat.exit(true);

    // if sellerSeat.give is empty then delete the property from availableProperties and exit the sellerSeat
    if (AmountMath.isEmpty(sellerSeat.getProposal().give.GiveAsset)) {
      delete availableProperties[want.WantAsset.brand.getAllegedName()];
      sellerSeat.exit();
    }
  };

  const getPropertyIssuers = () =>
    propertyMints.map(propertyMint => propertyMint.getIssuerRecord());

  const makeTradeInvitation = () =>
    zcf.makeInvitation(tradeHandler, 'buy assets', undefined, proposalShape);

  const publicFacet = Far('Asset Public Facet', {
    makeTradeInvitation,
    getPropertyIssuers,
  });
  return harden({ publicFacet });
};

harden(start);