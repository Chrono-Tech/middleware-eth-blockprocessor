const Method = require('web3-core-method');


module.exports = async (web3, hash) => {

  const method = new Method({
    name: 'getSignersAtHash',
    call: 'clique_getSignersAtHash',
    params: 1
  });

  method.attachToObject(web3);
  method.setRequestManager(web3._requestManager);

  try {
    let signers = await method.buildCall()(hash);
    return signers.map(signer=>signer.toLowerCase());
  } catch (e) {
    return [];
  }

};