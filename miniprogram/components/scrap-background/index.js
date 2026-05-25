Component({
  properties: {
    showPieces: {
      type: Boolean,
      value: true
    }
  },
  data: {
    scraps: [
      { top: '8%', left: '8%', right: 'auto', width: '72rpx', height: '72rpx', rotate: '-12deg' },
      { top: '16%', left: 'auto', right: '10%', width: '94rpx', height: '64rpx', rotate: '18deg' },
      { top: '38%', left: '78%', right: 'auto', width: '68rpx', height: '68rpx', rotate: '8deg' },
      { top: '56%', left: '4%', right: 'auto', width: '82rpx', height: '54rpx', rotate: '-24deg' },
      { top: '74%', left: 'auto', right: '12%', width: '90rpx', height: '58rpx', rotate: '22deg' },
      { top: '84%', left: '36%', right: 'auto', width: '60rpx', height: '60rpx', rotate: '-6deg' }
    ]
  }
});