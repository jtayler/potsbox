#!/bin/bash

mkdir -p att_sounds
cd att_sounds || exit 1

urls=(
  http://telephoneworld.org/wp-content/uploads/2021/01/atthur.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attearth.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attflood.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attmud.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attsw.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/atttor.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/atttf.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attngt.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attacbl.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/atttft.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attlct.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attemerg.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attnoans.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attnvc.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attntav.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attintl.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attcbc012.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-All-Circuits-Are-Busy-034-231226.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-All-Circuits-Busy-At-Location-076-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Call-Cannot-Be-Completed-034-231226.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Call-Did-Not-Go-Through-034-231226.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Due-To-A-Numbering-Change-076-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Due-To-An-Emergency-076-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Due-To-The-Earthquake-076-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Due-To-The-Flood-076-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Due-To-The-Hurricane-076-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Local-Telephone-Company-Trouble-076-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Telephone-Company-Facility-Trouble-076-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Number-Not-Available-From-Your-Calling-Area-034-231226.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-The-Area-Code-Has-Changed-to-239-076-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/N4E-Your-Call-Did-Not-Go-Through-male-230220.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/att8049l.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/attclec.mp3
  http://telephoneworld.org/wp-content/uploads/2023/12/att_clec_n4e_078_231226.mp3
  http://telephoneworld.org/wp-content/uploads/2021/01/returnprepaid.mp3
  http://telephoneworld.org/wp-content/uploads/2025/07/ATT-AC-684-no-longer-international-Feb-2007.mp3
  http://telephoneworld.org/wp-content/uploads/2025/07/att-private-network-Feb-2007.mp3
)

for url in "${urls[@]}"; do
  curl -LO "$url"
done
