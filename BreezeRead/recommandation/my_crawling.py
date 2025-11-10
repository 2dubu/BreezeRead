from http.client import HTTPSConnection
from urllib.parse import quote
from xml.etree.ElementTree import fromstring

class StringCleaner:
    @staticmethod
    def clean(txt):
        txt=txt.replace("&lt;/b&gt;0","")
        txt=txt.replace("&apos","")
        txt=txt.replace("&lt;/b&gt;","")
        txt=txt.replace("<b>","")
        txt=txt.replace("</b>","")
        txt=txt.replace("&quot;","")
        return txt
    
q="산불" 
q=quote(q)
# req header
h={"X-Naver-Client-Id" : "FN5LcznRqbcO34foOQjK","X-Naver-Client-Secret":"NExju9i_rd"}
hc=HTTPSConnection("openapi.naver.com")
# 요청 방식이 GET이라는 조건 
hc.request("GET","/v1/search/news.xml?query="+q,headers=h)
res=hc.getresponse() 
resBody=res.read() 
hc.close()

for n in fromstring(resBody).iter("item"):
    print(StringCleaner.clean(n.find("title").text))
    print(StringCleaner.clean(n.find("description").text))
    print("------------")
