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
  // console.log(subscriptions)
  for(let account of subscriptions){
    const market = await openBookProgram.account.market.fetch(account.obPubKey)
    const subscriptionId = solanaConnection.onAccountChange(
      market.asks,
      (updatedAccountInfo, ctx) => {
        console.log(`---Event Notification for ${account.proposalId} - ${account.obPubKey.toString()}`)
        console.log()
        try {
          const asks = openBookProgram.coder.accounts.decode('bookSide', updatedAccountInfo.data)
          const leafNodesData = asks.nodes.nodes.filter(
            (x: AnyNode) => x.tag === 2,
          );
          const leafNodes: LeafNode[] = [];
          for (const x of leafNodesData) {
            const leafNode: LeafNode = openBookProgram.coder.types.decode(
              'LeafNode',
              Buffer.from([0, ...x.data]),
            );
            const owner = leafNode.owner.toString()
            const size = leafNode.quantity.toNumber()
            const price = leafNode.key.shrn(64).toNumber()
            console.log(`Order updated for Proposal ${account.proposalId} - ${account.market}`)
            console.log(`By ${owner} on slot ${ctx.slot}`)
            console.log(`For ${size} @ $${price}`)
            console.log()
            //console.log(leafNode);
          }
        } catch (err) {
          console.error(err)
          console.log(updatedAccountInfo)
        }
      },
      "processed"
    );
    console.log(`Starting web socket, subscription ID: ${subscriptionId} ${account.proposalId} ${account.obPubKey.toString()}`);
  }
  
  
};

main();