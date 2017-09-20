const Web3 = require('web3'),
  web3 = new Web3();

module.exports = stringOrNumber => {
  let zeros = '000000000000000000000000000000000000000000000000000000000000000';
  if (typeof stringOrNumber === "string") {
    return (web3.toHex(stringOrNumber) + zeros).substr(0, 66);
  }
  let hexNumber = stringOrNumber.toString(16);
  return `0x${(zeros + hexNumber).substring(hexNumber.length - 1)}`;
};
