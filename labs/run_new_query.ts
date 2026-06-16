
import fs from 'fs';
import path from 'path';

async function fetchJobs() {
    const { gotScraping } = await import('got-scraping');
    const GQL_URL = 'https://www.upwork.com/api/graphql/v1';
    const UPWORK_URL = 'https://www.upwork.com/';
    const TOKEN_COOKIE = 'visitor_gql_token';

    const TOKEN_TTL_MS = 25 * 60 * 1000; // 25 minutes

    class TokenFetchFailed extends Error {
      constructor(msg: string) { super(msg); this.name = 'TokenFetchFailed'; }
    }
    class TokenExpired extends Error {
      constructor(msg: string) { super(msg); this.name = 'TokenExpired'; }
    }

    async function fetchTokenOnce(): Promise<string> {
        const { gotScraping } = await import('got-scraping');
        const res = await gotScraping({
            url: UPWORK_URL,
            headerGeneratorOptions: { devices: ['desktop'], operatingSystems: ['windows', 'macos'], browsers: ['chrome'] },
            timeout: { request: 30000 },
            followRedirect: true,
            throwHttpErrors: false,
        });
        for (const cookie of res.headers['set-cookie'] ?? []) {
            const m = cookie.match(new RegExp(`${TOKEN_COOKIE}=([^;]+)`));
            if (m) return decodeURIComponent(m[1]);
        }
        throw new TokenFetchFailed(`Cookie '${TOKEN_COOKIE}' not found in Upwork response.`);
    }

    class TokenManager {
      private _token: string | null = null;
      private _expiresAt: number | null = null;

      private isValid() {
        return this._token != null && this._expiresAt != null && Date.now() < this._expiresAt;
      }

      async getToken(): Promise<string> {
        if (this.isValid()) return this._token!;
        let lastErr: Error | null = null;
        for (let i = 1; i <= 3; i++) {
          try {
            this._token = await fetchTokenOnce();
            this._expiresAt = Date.now() + TOKEN_TTL_MS;
            return this._token;
          } catch (e) {
            lastErr = e instanceof Error ? e : new Error(String(e));
            await new Promise(r => setTimeout(r, 500 * i));
          }
        }
        throw new TokenFetchFailed(`Failed to obtain Upwork guest token after 3 attempts: ${lastErr?.message}`);
      }

      invalidate() {
        this._token = null;
        this._expiresAt = null;
      }
    }

    const tokenMgr = new TokenManager();

    const GQL_QUERY = `
      query UserJobSearch($requestVariables: UserJobSearchV1Request!) {
        search {
          universalSearchNuxt {
            userJobSearchV1(request: $requestVariables) {
              paging {
                total
                offset
                count
              }
              
        facets {
          jobType 
        {
          key
          value
        }
      
          workload 
        {
          key
          value
        }
      
          clientHires 
        {
          key
          value
        }
      
          durationV3 
        {
          key
          value
        }
      
          amount 
        {
          key
          value
        }
      
          contractorTier 
        {
          key
          value
        }
      
          contractToHire 
        {
          key
          value
        }
      
          
        paymentVerified: payment 
        {
          key
          value
        }
      
        proposals 
        {
          key
          value
        }
      
        previousClients 
        {
          key
          value
        }
      
      
        }
      
              results {
                id
                title
                description
                relevanceEncoded
                ontologySkills {
                  uid
                  parentSkillUid
                  prefLabel
                  prettyName: prefLabel
                  freeText
                  highlighted
                }
                
        isSTSVectorSearchResult
        applied
        upworkHistoryData {
          client {
            paymentVerificationStatus
            country
            totalReviews
            totalFeedback
            hasFinancialPrivacy
            totalSpent {
              isoCurrencyCode
              amount
            }
          }
          freelancerClientRelation {
            lastContractRid
            companyName
            lastContractTitle
          }
        }
                jobTile {
                  job {
                    id
                    ciphertext: cipherText
                    jobType
                    weeklyRetainerBudget
                    hourlyBudgetMax
                    hourlyBudgetMin
                    hourlyEngagementType
                    contractorTier
                    sourcingTimestamp
                    createTime
                    publishTime
                    
        enterpriseJob
        personsToHire
        premium
        totalApplicants
      
                    hourlyEngagementDuration {
                      rid
                      label
                      weeks
                      mtime
                      ctime
                    }
                    fixedPriceAmount {
                      isoCurrencyCode
                      amount
                    }
                    fixedPriceEngagementDuration {
                      id
                      rid
                      label
                      weeks
                      ctime
                      mtime
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const VARIABLES = {
      "requestVariables": {
        "proposals": ["0-4", "5-9", "10-14"],
        "sort": "relevance+desc",
        "highlight": true,
        "paging": { "offset": 0, "count": 20 }
      }
    };

    console.log("Fetching jobs with new query...");
        const TOKEN = await tokenMgr.getToken();
    try {
        const res = await gotScraping({
            url: GQL_URL,
            method: 'POST',
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
                Referer: 'https://www.upwork.com/nx/search/jobs/',
                'X-Upwork-Accept-Language': 'en-US',
                Authorization: `Bearer ${TOKEN}`,
            },
            json: { query: GQL_QUERY, variables: VARIABLES },
            headerGeneratorOptions: { devices: ['desktop'], operatingSystems: ['windows', 'macos'], browsers: ['chrome'] },
            timeout: { request: 30000 },
            throwHttpErrors: false,
        });

        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode === 200) {
            const body = JSON.parse(res.body);
            const results = body?.data?.search?.universalSearchNuxt?.userJobSearchV1?.results || [];
            console.log(`Found ${results.length} jobs.`);
            fs.writeFileSync(path.join(process.cwd(), 'labs', 'new_results.json'), JSON.stringify(body, null, 2));
            console.log("Saved results to new_results.json");
        } else {
            console.error("Failed to fetch jobs:", res.body);
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

fetchJobs();
