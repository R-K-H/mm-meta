import { AutocratProgram } from './types';
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, BN, Wallet, setProvider, utils } from '@coral-xyz/anchor';
import * as dotenv from 'dotenv'
dotenv.config()

const HTTP_ENDPOINT = process.env.RPC_URL as unknown as string
const solanaConnection = new Connection(HTTP_ENDPOINT);

const QUOTE_LOTS = 0.0001;
const kp = new Keypair()
const wallet = new Wallet(kp)
const provider = new AnchorProvider(solanaConnection, wallet, {skipPreflight: false, commitment: "processed"})
const AUTOCRAT_V0_1_IDL: AutocratProgram = require('./idl/autocrat_v0.1.json');

const OPENBOOK_PROGRAM_ID = new PublicKey('opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb');
const OPENBOOK_TWAP_PROGRAM_ID = new PublicKey(
  'TWAPrdhADy2aTKN5iFZtNnkQYXERD9NvKjPFVPMSCNN',
);

import { OpenbookV2, IDL as OPENBOOK_IDL, LeafNode, AnyNode } from '@openbook-dex/openbook-v2';

const autocrat = {
  label: 'V0.1' as string,
  programId: new PublicKey('metaX99LHn3A7Gr7VAcCfXhpfocvpMpqQ3eyp3PGUUq') as PublicKey,
  idl: AUTOCRAT_V0_1_IDL as AutocratProgram,
}

const autocratProgram = new Program<AutocratProgram>(autocrat.idl, autocrat.programId, provider)
const openBookProgram = new Program<OpenbookV2>(OPENBOOK_IDL, OPENBOOK_PROGRAM_ID, provider)

const main = async() =>{
  const proposals = await autocratProgram.account.proposal.all()
  const subscriptions: Array<{proposalId: number, twapPubKey: PublicKey, obPubKey: PublicKey, market: string}> = []
  for (let proposal of proposals){
    if (proposal.account.state.pending) {
      console.log(`Proposal ${proposal.account.number.toString()}`)
      console.log(`Account: ${proposal.publicKey.toString()}`)
      console.log(`Fail Market: ${proposal.account.openbookTwapFailMarket.toString()}`)
      console.log(`Pass Market: ${proposal.account.openbookTwapPassMarket.toString()}`)
      subscriptions.push({
        proposalId: parseInt(proposal.account.number.toString()),
        twapPubKey: proposal.account.openbookTwapFailMarket,
        obPubKey: proposal.account.openbookFailMarket,
        market: 'fail'
      })
      subscriptions.push({
        proposalId: parseInt(proposal.account.number.toString()),
        twapPubKey: proposal.account.openbookTwapPassMarket,
        obPubKey: proposal.account.openbookPassMarket,
        market: 'pass'
      })
    }
  }

  for(let account of subscriptions){
    const market = await openBookProgram.account.market.fetch(account.obPubKey)
    const asksSubscription = solanaConnection.onAccountChange(
      market.asks,
      (updatedAccountInfo, ctx) => {
        try {
          const leafNodes = openBookProgram.coder.accounts.decode('bookSide', updatedAccountInfo.data)
          const leafNodesData = leafNodes.nodes.nodes.filter(
            (x: AnyNode) => x.tag === 2,
          );
          const _asks: {
            price: number;
            size: number;
          }[] = leafNodesData
            .map((x: any) => {
              const leafNode: LeafNode = openBookProgram.coder.types.decode(
                'LeafNode',
                Buffer.from([0, ...x.data]),
              );
              const owner = leafNode.owner.toString()
              const size = leafNode.quantity.toNumber()
              const price = leafNode.key.shrn(64).toNumber() / 10_000
              console.log(`\x1b[31mAsk\x1b[0m on ${account.market} proposal ${account.proposalId} by ${owner} on slot ${ctx.slot} for ${size} @ $${price}`)
              return {
                price: price,
                size: size
              }
            })
            .sort((a: {price: number, size: number}, b: {price: number, size: number}) => a.price - b.price)
          
          const _aggreateAsks = new Map()
          _asks.forEach((order: {price: number, size: number}) => {
            if (_aggreateAsks.get(order.price) == undefined){
              _aggreateAsks.set(order.price, order.size)
            } else {
              _aggreateAsks.set(order.price, _aggreateAsks.get(order.price) + order.size)
            }
          })
          let asks: any[][]
          if (_aggreateAsks) {
            asks = Array.from(_aggreateAsks.entries()).map((side) => [
              (side[0].toFixed(4)),
              side[1]
            ])
          } else {
            return [[69, 0]]
          }
          console.log(asks)
        } catch (err) {
          console.error(err)
          console.log(updatedAccountInfo)
        }
      },
      "processed"
    );
    const bidsSubscription = solanaConnection.onAccountChange(
      market.bids,
      (updatedAccountInfo, ctx) => {
        try {
          const leafNodes = openBookProgram.coder.accounts.decode('bookSide', updatedAccountInfo.data)
          const leafNodesData = leafNodes.nodes.nodes.filter(
            (x: AnyNode) => x.tag === 2,
          );
          const _bids: {
            price: any;
            size: any;
          }[] = leafNodesData
            .map((x: any) => {
              const leafNode: LeafNode = openBookProgram.coder.types.decode(
                'LeafNode',
                Buffer.from([0, ...x.data]),
              );
              const price = leafNode.key.shrn(64).toNumber() / 10_000
              const size = leafNode.quantity.toNumber()
              const owner = leafNode.owner.toString()
              console.log(`\x1b[32mBid\x1b[0m on ${account.market} proposal ${account.proposalId} by ${owner} on slot ${ctx.slot} for ${size} @ $${price}`)
              return {
                price: price,
                size: size
              }
            })
            .sort((a: {price: number, size: number}, b: {price: number, size: number}) => b.price - a.price)
          const _aggreateBids = new Map()
          _bids.forEach((order: {price: number, size: number}) => {
            if (_aggreateBids.get(order.price) == undefined){
              _aggreateBids.set(order.price, order.size)
            } else {
              _aggreateBids.set(order.price, _aggreateBids.get(order.price) + order.size)
            }
          })
          let bids: any[][]
          if (_aggreateBids) {
            bids = Array.from(_aggreateBids.entries()).map((side) => [
              (side[0].toFixed(4)),
              side[1]
            ])
          } else {
            return [[0, 0]]
          }
          console.log(bids)
        } catch (err) {
          console.error(err)
          console.log(updatedAccountInfo)
        }
      },
      "processed"
    );
    console.log(`Starting web socket, Asks subscription ID: ${asksSubscription} ${account.proposalId} ${account.obPubKey.toString()}`);
    console.log(`Starting web socket, Bids subscription ID: ${bidsSubscription} ${account.proposalId} ${account.obPubKey.toString()}`);
  }
};

main();